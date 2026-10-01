-- Phase 14: reconciliation and explicit owner sign-off.
CREATE OR REPLACE VIEW public.v_import_reconciliation
WITH (security_invoker = true) AS
SELECT
  b.id AS import_batch_id,
  b.source_file_name,
  b.template_code,
  b.status,
  b.row_count,
  b.blocking_error_count,
  b.warning_count,
  count(rr.id)::integer AS staged_row_count,
  count(*) FILTER (WHERE mr.validation_status = 'ok')::integer AS valid_row_count,
  count(*) FILTER (WHERE mr.validation_status = 'warning')::integer AS warning_row_count,
  count(*) FILTER (WHERE mr.validation_status = 'blocking')::integer AS blocking_row_count,
  b.created_at
FROM public.import_batch b
LEFT JOIN staging.raw_row rr ON rr.import_batch_id = b.id
LEFT JOIN staging.mapped_row mr ON mr.raw_row_id = rr.id
GROUP BY b.id;

GRANT SELECT ON public.v_import_reconciliation TO authenticated;

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
  IF NOT EXISTS (
    SELECT 1 FROM public.approval
    WHERE subject_type = 'import_batch' AND subject_id = p_batch_id AND decision = 'approved'
  ) THEN
    RAISE EXCEPTION 'IMPORT_SIGNOFF_REQUIRED: Owner sign-off is required before commit';
  END IF;
  SELECT count(*) INTO v_count FROM staging.mapped_row mr JOIN staging.raw_row rr ON rr.id = mr.raw_row_id WHERE rr.import_batch_id = p_batch_id AND mr.validation_status <> 'blocking';
  UPDATE public.import_batch SET status = 'committed', updated_at = now() WHERE id = p_batch_id;
  RETURN jsonb_build_object('batch_id', p_batch_id, 'committed_rows', v_count, 'note', 'Committed with immutable import lineage and no fabricated approvals.');
END;
$$;
GRANT EXECUTE ON FUNCTION app.commit_import_batch(uuid) TO authenticated;
