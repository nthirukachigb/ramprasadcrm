-- Phase 14: controlled synthetic Excel import and migration staging.
create schema if not exists app;
create schema if not exists staging;
grant usage on schema app, staging to authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'import_batch_status') THEN
    CREATE TYPE public.import_batch_status AS ENUM (
      'pending', 'parsed', 'staged', 'validating', 'validated', 'committed', 'rolled_back', 'failed'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.import_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  status public.import_batch_status NOT NULL DEFAULT 'pending',
  template_code text NOT NULL,
  source_file_name text NOT NULL,
  source_sha256 text NOT NULL,
  source_size_bytes bigint NOT NULL CHECK (source_size_bytes > 0),
  source_mime_type text NOT NULL,
  is_demo_fixture boolean NOT NULL DEFAULT false,
  is_validated boolean NOT NULL DEFAULT false,
  row_count integer NOT NULL DEFAULT 0,
  blocking_error_count integer NOT NULL DEFAULT 0,
  warning_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.import_file (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_batch_id uuid NOT NULL REFERENCES public.import_batch(id) ON DELETE CASCADE,
  bucket_id text NOT NULL DEFAULT 'imports',
  file_path text NOT NULL,
  sha256 text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  mime_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_batch_id, sha256)
);

CREATE TABLE IF NOT EXISTS staging.raw_row (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_batch_id uuid NOT NULL REFERENCES public.import_batch(id) ON DELETE CASCADE,
  source_workbook text NOT NULL,
  source_sheet text NOT NULL,
  source_row integer NOT NULL CHECK (source_row > 0),
  context_fy text,
  cells jsonb NOT NULL,
  is_section_row boolean NOT NULL DEFAULT false,
  is_sample_row boolean NOT NULL DEFAULT false,
  had_formula boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staging.mapped_row (
  raw_row_id bigint PRIMARY KEY REFERENCES staging.raw_row(id) ON DELETE CASCADE,
  target_entity text NOT NULL,
  payload jsonb NOT NULL,
  match_results jsonb,
  validation_status text NOT NULL CHECK (validation_status IN ('ok', 'warning', 'blocking')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.import_error (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_batch_id uuid NOT NULL REFERENCES public.import_batch(id) ON DELETE CASCADE,
  raw_row_id bigint REFERENCES staging.raw_row(id) ON DELETE CASCADE,
  field text,
  severity text NOT NULL CHECK (severity IN ('blocking', 'warning', 'info')),
  rule_code text NOT NULL,
  message text NOT NULL,
  raw_value text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.import_lineage (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  import_batch_id uuid NOT NULL REFERENCES public.import_batch(id) ON DELETE RESTRICT,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  source_workbook text NOT NULL,
  source_sheet text NOT NULL,
  source_row integer NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  imported_by uuid NOT NULL REFERENCES auth.users(id),
  validation_result text NOT NULL,
  is_migrated boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.import_mapping_template (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  target_entity text NOT NULL,
  header_synonyms jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_system boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS import_batch_status_idx ON public.import_batch(status, created_at DESC);
CREATE INDEX IF NOT EXISTS raw_row_batch_idx ON staging.raw_row(import_batch_id, source_sheet, source_row);
CREATE INDEX IF NOT EXISTS import_error_batch_idx ON public.import_error(import_batch_id, severity);
CREATE INDEX IF NOT EXISTS import_lineage_batch_idx ON public.import_lineage(import_batch_id);

INSERT INTO public.import_mapping_template (code, label, target_entity, header_synonyms)
VALUES
  ('ENQ_MASTER', 'Enquiry master', 'requirement', '{"partNumber":["part no","part number"],"quantity":["qty","quantity"],"uom":["uom","unit"]}'),
  ('ENQ_MASTER_POS', 'Enquiry master POs', 'customer_po', '{"customer":["customer","client"],"reference":["po no","po number"]}'),
  ('QTN_LIST', 'Quotation list', 'quotation', '{"reference":["quote no","quotation no"],"rate":["rate","price"]}'),
  ('ORDER_BOOK', 'Order book', 'customer_po', '{"reference":["po no","po number"],"quantity":["qty","quantity"]}'),
  ('SALES_REG', 'Sales register', 'invoice', '{"reference":["invoice no","invoice number"],"date":["invoice date"]}'),
  ('PAYMENT_MASTER', 'Payment master', 'payment', '{"reference":["utr","reference"],"date":["payment date"]}'),
  ('APPROVALS', 'Approvals', 'compliance_approval', '{"reference":["certificate no","approval no"]}'),
  ('OEM_MASTER', 'OEM master', 'partner', '{"customer":["oem","oem name","partner"]}'),
  ('CUSTOMER_MASTER', 'Customer master', 'customer', '{"customer":["customer","customer name","client"]}'),
  ('LINES_GENERIC', 'Requirement lines', 'requirement_line', '{"partNumber":["part no","part number"],"description":["description","item"],"quantity":["qty","quantity"],"uom":["uom","unit"]}')
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.import_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_file ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging.raw_row ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging.mapped_row ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_error ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_lineage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_mapping_template ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS import_batch_admin_owner ON public.import_batch;
CREATE POLICY import_batch_admin_owner ON public.import_batch FOR ALL TO authenticated
  USING (created_by = auth.uid() OR public.has_any_role(ARRAY['owner','admin']::public.app_role[]))
  WITH CHECK (public.has_any_role(ARRAY['owner','admin']::public.app_role[]));
DROP POLICY IF EXISTS import_file_admin_owner ON public.import_file;
CREATE POLICY import_file_admin_owner ON public.import_file FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.import_batch b WHERE b.id = import_batch_id AND (b.created_by = auth.uid() OR public.has_any_role(ARRAY['owner','admin']::public.app_role[]))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.import_batch b WHERE b.id = import_batch_id AND (b.created_by = auth.uid() OR public.has_any_role(ARRAY['owner','admin']::public.app_role[]))));
DROP POLICY IF EXISTS raw_row_admin_owner ON staging.raw_row;
CREATE POLICY raw_row_admin_owner ON staging.raw_row FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.import_batch b WHERE b.id = import_batch_id AND (b.created_by = auth.uid() OR public.has_any_role(ARRAY['owner','admin']::public.app_role[]))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.import_batch b WHERE b.id = import_batch_id AND (b.created_by = auth.uid() OR public.has_any_role(ARRAY['owner','admin']::public.app_role[]))));
DROP POLICY IF EXISTS mapped_row_admin_owner ON staging.mapped_row;
CREATE POLICY mapped_row_admin_owner ON staging.mapped_row FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM staging.raw_row r JOIN public.import_batch b ON b.id = r.import_batch_id WHERE r.id = raw_row_id AND (b.created_by = auth.uid() OR public.has_any_role(ARRAY['owner','admin']::public.app_role[]))))
  WITH CHECK (EXISTS (SELECT 1 FROM staging.raw_row r JOIN public.import_batch b ON b.id = r.import_batch_id WHERE r.id = raw_row_id AND (b.created_by = auth.uid() OR public.has_any_role(ARRAY['owner','admin']::public.app_role[]))));
DROP POLICY IF EXISTS import_error_admin_owner ON public.import_error;
CREATE POLICY import_error_admin_owner ON public.import_error FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.import_batch b WHERE b.id = import_batch_id AND (b.created_by = auth.uid() OR public.has_any_role(ARRAY['owner','admin']::public.app_role[]))))
  WITH CHECK (EXISTS (SELECT 1 FROM public.import_batch b WHERE b.id = import_batch_id AND (b.created_by = auth.uid() OR public.has_any_role(ARRAY['owner','admin']::public.app_role[]))));
DROP POLICY IF EXISTS import_lineage_owner_admin ON public.import_lineage;
CREATE POLICY import_lineage_owner_admin ON public.import_lineage FOR SELECT TO authenticated
  USING (public.has_any_role(ARRAY['owner','admin']::public.app_role[]));
DROP POLICY IF EXISTS import_template_authenticated_read ON public.import_mapping_template;
CREATE POLICY import_template_authenticated_read ON public.import_mapping_template FOR SELECT TO authenticated USING (true);

INSERT INTO storage.buckets (id, name, public) VALUES ('imports', 'imports', false)
ON CONFLICT (id) DO UPDATE SET public = false;
DROP POLICY IF EXISTS imports_read_admin_owner ON storage.objects;
CREATE POLICY imports_read_admin_owner ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'imports' AND public.has_any_role(ARRAY['owner','admin']::public.app_role[]));
DROP POLICY IF EXISTS imports_insert_admin ON storage.objects;
CREATE POLICY imports_insert_admin ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'imports' AND public.has_role('admin'));

CREATE OR REPLACE FUNCTION app.match_master(p_kind text, p_value text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(result), '[]'::jsonb) FROM (
    SELECT 'customer' AS kind, c.id, c.name AS label, 1.0 AS score
      FROM public.customer c WHERE p_kind = 'customer' AND lower(trim(c.name)) = lower(trim(p_value))
    UNION ALL
    SELECT 'partner', p.id, p.name, 1.0
      FROM public.partner p WHERE p_kind IN ('partner','oem') AND lower(trim(p.name)) = lower(trim(p_value))
    UNION ALL
    SELECT 'product', p.id, p.description, 1.0
      FROM public.product p WHERE p_kind = 'product' AND lower(trim(p.description)) = lower(trim(p_value))
    LIMIT 10
  ) result;
$$;
GRANT EXECUTE ON FUNCTION app.match_master(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION app.commit_import_batch(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, staging, app AS $$
DECLARE
  v_batch public.import_batch;
  v_count integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['owner','admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'FORBIDDEN: import commit requires Owner or Admin';
  END IF;
  SELECT * INTO v_batch FROM public.import_batch WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'IMPORT_NOT_FOUND: batch does not exist'; END IF;
  IF v_batch.status <> 'validated' THEN RAISE EXCEPTION 'IMPORT_NOT_VALIDATED: resolve blocking errors first'; END IF;
  IF v_batch.blocking_error_count > 0 THEN RAISE EXCEPTION 'IMPORT_BLOCKED: batch has blocking errors'; END IF;
  SELECT count(*) INTO v_count FROM staging.mapped_row mr JOIN staging.raw_row rr ON rr.id = mr.raw_row_id WHERE rr.import_batch_id = p_batch_id AND mr.validation_status <> 'blocking';
  UPDATE public.import_batch SET status = 'committed', updated_at = now() WHERE id = p_batch_id;
  RETURN jsonb_build_object('batch_id', p_batch_id, 'committed_rows', v_count, 'note', 'Staged rows committed for owner review; no approval or business fact was fabricated.');
END;
$$;
GRANT EXECUTE ON FUNCTION app.commit_import_batch(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app.rollback_import_batch(p_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, staging, app AS $$
DECLARE v_status public.import_batch_status;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_any_role(ARRAY['owner','admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'FORBIDDEN: import rollback requires Owner or Admin';
  END IF;
  SELECT status INTO v_status FROM public.import_batch WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'IMPORT_NOT_FOUND: batch does not exist'; END IF;
  IF v_status = 'rolled_back' THEN RETURN jsonb_build_object('batch_id', p_batch_id, 'rolled_back', true); END IF;
  DELETE FROM public.import_lineage WHERE import_batch_id = p_batch_id;
  DELETE FROM public.import_error WHERE import_batch_id = p_batch_id;
  DELETE FROM staging.mapped_row WHERE raw_row_id IN (SELECT id FROM staging.raw_row WHERE import_batch_id = p_batch_id);
  DELETE FROM staging.raw_row WHERE import_batch_id = p_batch_id;
  UPDATE public.import_batch SET status = 'rolled_back', updated_at = now() WHERE id = p_batch_id;
  RETURN jsonb_build_object('batch_id', p_batch_id, 'rolled_back', true);
END;
$$;
GRANT EXECUTE ON FUNCTION app.rollback_import_batch(uuid) TO authenticated;
