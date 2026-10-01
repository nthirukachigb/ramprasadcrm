-- ===========================================================================
-- Defence Contract CRM - Phase 7 (Customer PO, mismatch, supplier PO)
-- ---------------------------------------------------------------------------
-- Run APPLY_MANUALLY_PHASE6.sql first, then paste this file into the Supabase
-- SQL Editor and run it. Idempotent (safe to re-run).
--   0020_customer_po.sql 0021_po_mismatch.sql 0022_po_amendment.sql
--   0023_supplier_po.sql 0024_tile_d05.sql
-- ===========================================================================

-- >>> supabase/migrations/0020_customer_po.sql
-- Defence Contract CRM â€” Phase 7: Customer PO schema (T7.1)
-- A customer PO must reference an approved/submitted quotation version that
-- has an approval record. Deliveries are scheduled per line.
-- Idempotent. Depends on 0018_outcome.sql.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'customer_po_status') then
    create type public.customer_po_status as enum (
      'received', 'under_review', 'acknowledged', 'amended', 'completed', 'cancelled'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. customer_po
-- ---------------------------------------------------------------------------
create table if not exists public.customer_po (
  id uuid primary key default gen_random_uuid(),
  internal_ref text unique,
  quotation_version_id uuid not null references public.quotation_version (id),
  customer_id uuid not null references public.customer (id),
  customer_po_number text not null,
  po_date date,
  received_date date not null default current_date,
  customer_reference text,
  pdi_required boolean not null default false,
  ld_terms text,
  documents_required text,
  payment_terms text,
  delivery_terms text,
  status public.customer_po_status not null default 'received',
  acknowledgement_document_id uuid references public.document (id) on delete set null,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  approval_id uuid references public.approval (id) on delete set null,
  notes text,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, customer_po_number)
);

create index if not exists customer_po_version_idx on public.customer_po (quotation_version_id);
create index if not exists customer_po_customer_idx on public.customer_po (customer_id);

create or replace function public.set_po_ref()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.internal_ref is null or btrim(new.internal_ref) = '' then
    new.internal_ref := public.next_ref('PO');
  end if;
  return new;
end;
$$;

drop trigger if exists customer_po_set_ref on public.customer_po;
create trigger customer_po_set_ref
  before insert on public.customer_po
  for each row execute function public.set_po_ref();

-- BR-02: the referenced quotation version must be approved/submitted with an
-- approval record.
create or replace function public.check_po_quotation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.quotation_status;
  v_approved_at timestamptz;
begin
  select status, approved_at into v_status, v_approved_at
  from public.quotation_version where id = new.quotation_version_id;

  if v_status is null then
    raise exception 'BR-02: the quotation version does not exist';
  end if;
  if v_status not in ('approved', 'submitted') then
    raise exception
      'BR-02: a customer PO must reference an approved or submitted quotation version (this one is %)',
      v_status;
  end if;
  if v_approved_at is null then
    raise exception 'BR-02: the quoted version has no approval record';
  end if;
  return new;
end;
$$;

drop trigger if exists customer_po_requires_approved on public.customer_po;
create trigger customer_po_requires_approved
  before insert or update on public.customer_po
  for each row execute function public.check_po_quotation();

-- ---------------------------------------------------------------------------
-- 2. po_line
-- ---------------------------------------------------------------------------
create table if not exists public.po_line (
  id uuid primary key default gen_random_uuid(),
  customer_po_id uuid not null references public.customer_po (id) on delete cascade,
  quotation_line_id uuid not null references public.quotation_line (id),
  requirement_line_id uuid not null references public.requirement_line (id),
  qty_ordered numeric(14, 3) not null check (qty_ordered > 0),
  qty_ordered_effective numeric(14, 3) not null check (qty_ordered_effective > 0),
  unit_rate numeric(14, 4) not null check (unit_rate > 0),
  uom text not null,
  delivery_terms text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_po_id, quotation_line_id)
);

create index if not exists po_line_po_idx on public.po_line (customer_po_id);
create index if not exists po_line_requirement_line_idx on public.po_line (requirement_line_id);

-- A PO line must reference a line of the PO's own quotation version.
create or replace function public.check_po_line_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match boolean;
begin
  select exists (
    select 1
    from public.quotation_line ql
    join public.customer_po po on po.id = new.customer_po_id
    where ql.id = new.quotation_line_id
      and ql.quotation_version_id = po.quotation_version_id
      and ql.requirement_line_id = new.requirement_line_id
  ) into v_match;
  if not v_match then
    raise exception 'BR-02: the PO line must belong to the PO''s quotation version';
  end if;
  return new;
end;
$$;

drop trigger if exists po_line_version on public.po_line;
create trigger po_line_version
  before insert or update on public.po_line
  for each row execute function public.check_po_line_version();

-- ---------------------------------------------------------------------------
-- 3. po_delivery_schedule (Î£ qty = line qty, deferred)
-- ---------------------------------------------------------------------------
create table if not exists public.po_delivery_schedule (
  id uuid primary key default gen_random_uuid(),
  po_line_id uuid not null references public.po_line (id) on delete cascade,
  sequence integer not null default 1,
  qty numeric(14, 3) not null check (qty > 0),
  due_date date,
  original_committed_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (po_line_id, sequence)
);

create index if not exists po_delivery_schedule_line_idx
  on public.po_delivery_schedule (po_line_id);

-- original_committed_date is immutable once set.
create or replace function public.lock_original_committed_date()
returns trigger
language plpgsql
as $$
begin
  if old.original_committed_date is not null
     and new.original_committed_date is distinct from old.original_committed_date then
    raise exception 'BR-24: the original committed date cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists po_delivery_lock_original on public.po_delivery_schedule;
create trigger po_delivery_lock_original
  before update on public.po_delivery_schedule
  for each row execute function public.lock_original_committed_date();

-- Where a line has schedule rows, their quantities must sum to the line qty.
create or replace function public.check_po_schedule_sum()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line uuid := coalesce(new.po_line_id, old.po_line_id);
  v_sum numeric;
  v_effective numeric;
begin
  select coalesce(sum(qty), 0) into v_sum
  from public.po_delivery_schedule where po_line_id = v_line;

  select qty_ordered_effective into v_effective
  from public.po_line where id = v_line;

  if v_effective is null then
    return null;  -- line deleted
  end if;
  if v_sum > 0 and v_sum <> v_effective then
    raise exception
      'FR-PO-06: delivery schedule quantities (%) must equal the ordered quantity (%)',
      v_sum, v_effective;
  end if;
  return null;
end;
$$;

drop trigger if exists po_delivery_schedule_sum on public.po_delivery_schedule;
create constraint trigger po_delivery_schedule_sum
  after insert or update or delete on public.po_delivery_schedule
  deferrable initially deferred
  for each row execute function public.check_po_schedule_sum();

-- ---------------------------------------------------------------------------
-- 4. Audit, updated_at, row_version and actor stamping
-- ---------------------------------------------------------------------------
create or replace function public.stamp_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.updated_by := coalesce(new.updated_by, auth.uid());
  elsif tg_op = 'UPDATE' then
    new.updated_by := coalesce(new.updated_by, auth.uid());
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
  v_has_created boolean;
begin
  foreach t in array array['customer_po', 'po_line', 'po_delivery_schedule'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t, t);
    execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'row_version'
    ) into v_has_created;
    if v_has_created then
      execute format('drop trigger if exists %I_row_version on public.%I', t, t);
      execute format('create trigger %I_row_version before update on public.%I for each row execute function public.bump_row_version()', t, t);
    end if;

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'created_by'
    ) into v_has_created;
    if v_has_created then
      execute format('drop trigger if exists %I_stamp_actor on public.%I', t, t);
      execute format('create trigger %I_stamp_actor before insert or update on public.%I for each row execute function public.stamp_actor()', t, t);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Row Level Security and grants
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  v_write text := 'public.has_any_role(array[''owner'',''sales'',''operations'',''admin'']::public.app_role[])';
begin
  foreach t in array array['customer_po', 'po_line', 'po_delivery_schedule'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select to authenticated using (true)', t, t);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (%s)', t, t, v_write);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated using (%s) with check (%s)', t, t, v_write, v_write);
    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (%s)', t, t, v_write);
  end loop;
end
$$;

grant select, insert, update, delete on public.customer_po to authenticated;
grant select, insert, update, delete on public.po_line to authenticated;
grant select, insert, update, delete on public.po_delivery_schedule to authenticated;

-- >>> supabase/migrations/0021_po_mismatch.sql
-- Defence Contract CRM â€” Phase 7: PO mismatch detection and acknowledgement gate (T7.3)
-- Rate, quantity and term differences are captured as po_mismatch rows, and a
-- customer PO cannot be acknowledged while a medium/high mismatch is unresolved
-- or its acceptance is not approved (FR-PO-02/03/04, BR-16).
-- Idempotent. Depends on 0020_customer_po.sql.

-- ---------------------------------------------------------------------------
-- 1. po_mismatch
-- ---------------------------------------------------------------------------
create table if not exists public.po_mismatch (
  id uuid primary key default gen_random_uuid(),
  customer_po_id uuid not null references public.customer_po (id) on delete cascade,
  po_line_id uuid references public.po_line (id) on delete cascade,
  field text not null,
  quoted_value text,
  po_value text,
  severity text not null default 'medium' check (severity in ('info', 'medium', 'high')),
  resolution text not null default 'open'
    check (resolution in ('open', 'corrected', 'amendment_requested', 'accepted')),
  approval_id uuid references public.approval (id) on delete set null,
  reason text,
  resolved_by uuid,
  resolved_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists po_mismatch_po_idx on public.po_mismatch (customer_po_id);
create index if not exists po_mismatch_line_idx on public.po_mismatch (po_line_id);

-- Helper: raise a mismatch and (for non-info) request an approval.
create or replace function public.raise_po_mismatch(
  p_po uuid,
  p_line uuid,
  p_field text,
  p_quoted text,
  p_po_value text,
  p_severity text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_approval uuid;
begin
  insert into public.po_mismatch
    (customer_po_id, po_line_id, field, quoted_value, po_value, severity)
  values (p_po, p_line, p_field, p_quoted, p_po_value, p_severity)
  returning id into v_id;

  if p_severity <> 'info' and auth.uid() is not null then
    v_approval := public.request_approval(
      'po_mismatch', v_id,
      format('PO mismatch on %s: quoted %s vs PO %s', p_field, p_quoted, p_po_value));
    update public.po_mismatch set approval_id = v_approval where id = v_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Line-level mismatch trigger (TECH-STACK Â§10.5)
-- ---------------------------------------------------------------------------
create or replace function public.po_line_mismatch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ql record;
  v_severity text;
  v_qty_severity text;
  v_won numeric;
begin
  -- Recompute open line mismatches.
  delete from public.po_mismatch
  where po_line_id = new.id and resolution = 'open';

  select proposed_unit_price, qty_quoted, uom, requirement_line_id, quotation_version_id
  into ql
  from public.quotation_line where id = new.quotation_line_id;
  if ql is null then
    return new;
  end if;

  if new.unit_rate <> ql.proposed_unit_price then
    perform public.raise_po_mismatch(
      new.customer_po_id, new.id, 'unit_rate',
      ql.proposed_unit_price::text, new.unit_rate::text, 'high');
  end if;

  if new.uom <> ql.uom then
    perform public.raise_po_mismatch(
      new.customer_po_id, new.id, 'uom', ql.uom, new.uom, 'high');
  end if;

  if new.qty_ordered <> ql.qty_quoted then
    -- A partial award is informational (downgrade).
    select coalesce(sum(lo.qty_won), 0) into v_won
    from public.line_outcome lo
    where lo.quotation_version_id = ql.quotation_version_id
      and lo.requirement_line_id = ql.requirement_line_id;

    if new.qty_ordered < ql.qty_quoted and v_won > 0 then
      v_qty_severity := 'info';
    elsif new.qty_ordered > ql.qty_quoted then
      v_qty_severity := 'high';
    else
      v_qty_severity := 'medium';
    end if;

    perform public.raise_po_mismatch(
      new.customer_po_id, new.id, 'qty',
      ql.qty_quoted::text, new.qty_ordered::text, v_qty_severity);
  end if;

  return new;
end;
$$;

drop trigger if exists po_line_mismatch_trg on public.po_line;
create trigger po_line_mismatch_trg
  after insert or update on public.po_line
  for each row execute function public.po_line_mismatch();

-- ---------------------------------------------------------------------------
-- 3. Header-level term mismatch trigger
-- ---------------------------------------------------------------------------
create or replace function public.po_header_mismatch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  qv record;
begin
  -- Only react when a term actually changes (or on insert).
  if tg_op = 'UPDATE'
     and new.payment_terms is not distinct from old.payment_terms
     and new.delivery_terms is not distinct from old.delivery_terms then
    return new;
  end if;

  select payment_terms, delivery_terms into qv
  from public.quotation_version where id = new.quotation_version_id;
  if qv is null then
    return new;
  end if;

  if new.payment_terms is not null and qv.payment_terms is not null
     and lower(btrim(new.payment_terms)) <> lower(btrim(qv.payment_terms))
     and not exists (
       select 1 from public.po_mismatch
       where customer_po_id = new.id and field = 'payment_terms'
     ) then
    perform public.raise_po_mismatch(
      new.id, null, 'payment_terms', qv.payment_terms, new.payment_terms, 'medium');
  end if;

  if new.delivery_terms is not null and qv.delivery_terms is not null
     and lower(btrim(new.delivery_terms)) <> lower(btrim(qv.delivery_terms))
     and not exists (
       select 1 from public.po_mismatch
       where customer_po_id = new.id and field = 'delivery_terms'
     ) then
    perform public.raise_po_mismatch(
      new.id, null, 'delivery_terms', qv.delivery_terms, new.delivery_terms, 'medium');
  end if;

  return new;
end;
$$;

drop trigger if exists po_header_mismatch_trg on public.customer_po;
create trigger po_header_mismatch_trg
  after insert or update on public.customer_po
  for each row execute function public.po_header_mismatch();

-- ---------------------------------------------------------------------------
-- 4. Status transitions with the acknowledgement gate
-- ---------------------------------------------------------------------------
insert into public.ref_status_transition (entity, from_status, to_status, requires_approval)
values
  ('customer_po', 'received', 'under_review', false),
  ('customer_po', 'received', 'cancelled', false),
  ('customer_po', 'under_review', 'acknowledged', false),
  ('customer_po', 'under_review', 'cancelled', false),
  ('customer_po', 'acknowledged', 'amended', false),
  ('customer_po', 'acknowledged', 'completed', false),
  ('customer_po', 'acknowledged', 'cancelled', false),
  ('customer_po', 'amended', 'acknowledged', false),
  ('customer_po', 'amended', 'completed', false),
  ('customer_po', 'amended', 'cancelled', false)
on conflict (entity, from_status, to_status) do nothing;

create or replace function public.transition_customer_po(
  p_id uuid,
  p_to_status public.customer_po_status,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.customer_po;
  v_allowed boolean;
  v_blocking integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.has_any_role(
    array['owner', 'sales', 'operations', 'admin']::public.app_role[]
  ) then
    raise exception 'FORBIDDEN: you may not change a customer PO';
  end if;

  select * into v_po from public.customer_po where id = p_id for update;
  if not found then
    raise exception 'Customer PO not found';
  end if;

  select true into v_allowed
  from public.ref_status_transition t
  where t.entity = 'customer_po'
    and t.from_status = v_po.status::text
    and t.to_status = p_to_status::text;
  if v_allowed is null then
    raise exception 'BR-30: invalid customer PO transition from % to %',
      v_po.status, p_to_status;
  end if;

  -- Acknowledgement gate (FR-PO-04).
  if p_to_status = 'acknowledged' then
    select count(*) into v_blocking
    from public.po_mismatch m
    where m.customer_po_id = p_id
      and m.severity in ('medium', 'high')
      and (
        m.resolution = 'open'
        or (
          m.resolution = 'accepted'
          and not exists (
            select 1 from public.approval a
            where a.id = m.approval_id and a.decision = 'approved'
          )
        )
      );
    if v_blocking > 0 then
      raise exception
        'FR-PO-04: % unresolved or unapproved mismatch(es) must be resolved before acknowledgement',
        v_blocking;
    end if;
  end if;

  update public.customer_po
     set status = p_to_status,
         acknowledged_at = case when p_to_status = 'acknowledged' then now() else acknowledged_at end,
         acknowledged_by = case when p_to_status = 'acknowledged' then auth.uid() else acknowledged_by end,
         updated_at = now()
   where id = p_id;

  insert into public.status_history
    (entity_type, entity_id, from_status, to_status, actor, reason)
  values
    ('customer_po', p_id, v_po.status::text, p_to_status::text, auth.uid(), p_reason);
end;
$$;

grant execute on function public.transition_customer_po(uuid, public.customer_po_status, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Audit, updated_at and RLS for po_mismatch
-- ---------------------------------------------------------------------------
do $$
begin
  execute 'drop trigger if exists po_mismatch_audit on public.po_mismatch';
  execute 'create trigger po_mismatch_audit after insert or update or delete on public.po_mismatch for each row execute function public.audit_row_change()';
  execute 'drop trigger if exists po_mismatch_updated_at on public.po_mismatch';
  execute 'create trigger po_mismatch_updated_at before update on public.po_mismatch for each row execute function public.set_updated_at()';
end
$$;

alter table public.po_mismatch enable row level security;
drop policy if exists po_mismatch_select on public.po_mismatch;
create policy po_mismatch_select on public.po_mismatch
  for select to authenticated using (true);
drop policy if exists po_mismatch_write on public.po_mismatch;
create policy po_mismatch_write on public.po_mismatch
  for all to authenticated
  using (public.has_any_role(array['owner','sales','operations','admin']::public.app_role[]))
  with check (public.has_any_role(array['owner','sales','operations','admin']::public.app_role[]));

grant select, insert, update, delete on public.po_mismatch to authenticated;

-- >>> supabase/migrations/0022_po_amendment.sql
-- Defence Contract CRM â€” Phase 7: PO amendments (T7.4)
-- Amendments are versioned child records; both original and amended values stay
-- visible. Applying an amendment updates the effective quantity/rate and reruns
-- the mismatch check.
-- Idempotent. Depends on 0021_po_mismatch.sql.

create table if not exists public.po_amendment (
  id uuid primary key default gen_random_uuid(),
  customer_po_id uuid not null references public.customer_po (id) on delete cascade,
  amendment_no integer not null check (amendment_no > 0),
  amendment_date date not null default current_date,
  reason text,
  document_id uuid references public.document (id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'applied', 'cancelled')),
  approval_id uuid references public.approval (id) on delete set null,
  applied_at timestamptz,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_po_id, amendment_no)
);

create table if not exists public.po_amendment_change (
  id uuid primary key default gen_random_uuid(),
  po_amendment_id uuid not null references public.po_amendment (id) on delete cascade,
  po_line_id uuid not null references public.po_line (id) on delete cascade,
  field text not null check (field in ('qty', 'unit_rate', 'delivery_terms', 'other')),
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);

create index if not exists po_amendment_change_idx
  on public.po_amendment_change (po_amendment_id);

-- Apply an amendment: update effective quantity/rate, then re-run the mismatch
-- check (the po_line update trigger does this). Material changes raise an
-- approval request so the Owner records the decision.
create or replace function public.apply_po_amendment(p_amendment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amendment public.po_amendment;
  v_change record;
  v_material boolean := false;
  v_approval uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.has_any_role(
    array['owner', 'sales', 'operations', 'admin']::public.app_role[]
  ) then
    raise exception 'FORBIDDEN: you may not apply a PO amendment';
  end if;

  select * into v_amendment from public.po_amendment where id = p_amendment_id for update;
  if not found then
    raise exception 'Amendment not found';
  end if;
  if v_amendment.status <> 'draft' then
    raise exception 'This amendment has already been applied';
  end if;

  for v_change in
    select * from public.po_amendment_change where po_amendment_id = p_amendment_id
  loop
    if v_change.field = 'qty' then
      update public.po_line
         set qty_ordered_effective = v_change.new_value::numeric
       where id = v_change.po_line_id;
      v_material := true;
    elsif v_change.field = 'unit_rate' then
      update public.po_line
         set unit_rate = v_change.new_value::numeric
       where id = v_change.po_line_id;
      v_material := true;
    elsif v_change.field = 'delivery_terms' then
      update public.po_line
         set delivery_terms = v_change.new_value
       where id = v_change.po_line_id;
    end if;
  end loop;

  if v_material and auth.uid() is not null then
    v_approval := public.request_approval(
      'po_amendment', p_amendment_id,
      coalesce(v_amendment.reason, 'PO amendment applied'));
  end if;

  update public.po_amendment
     set status = 'applied',
         applied_at = now(),
         approval_id = coalesce(v_approval, approval_id),
         updated_at = now()
   where id = p_amendment_id;

  update public.customer_po
     set status = 'amended', updated_at = now()
   where id = v_amendment.customer_po_id
     and status = 'acknowledged';
end;
$$;

grant execute on function public.apply_po_amendment(uuid) to authenticated;

create or replace function public.stamp_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.updated_by := coalesce(new.updated_by, auth.uid());
  elsif tg_op = 'UPDATE' then
    new.updated_by := coalesce(new.updated_by, auth.uid());
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['po_amendment'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t, t);
    execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
    execute format('drop trigger if exists %I_row_version on public.%I', t, t);
    execute format('create trigger %I_row_version before update on public.%I for each row execute function public.bump_row_version()', t, t);
    execute format('drop trigger if exists %I_stamp_actor on public.%I', t, t);
    execute format('create trigger %I_stamp_actor before insert or update on public.%I for each row execute function public.stamp_actor()', t, t);
  end loop;
  execute 'drop trigger if exists po_amendment_change_audit on public.po_amendment_change';
  execute 'create trigger po_amendment_change_audit after insert or update or delete on public.po_amendment_change for each row execute function public.audit_row_change()';
end
$$;

do $$
declare
  t text;
  v_write text := 'public.has_any_role(array[''owner'',''sales'',''operations'',''admin'']::public.app_role[])';
begin
  foreach t in array array['po_amendment', 'po_amendment_change'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select to authenticated using (true)', t, t);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (%s)', t, t, v_write);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated using (%s) with check (%s)', t, t, v_write, v_write);
    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (%s)', t, t, v_write);
  end loop;
end
$$;

grant select, insert, update, delete on public.po_amendment to authenticated;
grant select, insert, update, delete on public.po_amendment_change to authenticated;

-- >>> supabase/migrations/0023_supplier_po.sql
-- Defence Contract CRM â€” Phase 7: Supplier PO and PO-level coverage (T7.5)
-- The buying side, linked to customer PO lines. A partner other than the
-- approved OEM selection needs an owner approval. Every supplier PO line
-- resolves to exactly one requirement line (FR-SPO-01).
-- Idempotent. Depends on 0022_po_amendment.sql.

create table if not exists public.supplier_po (
  id uuid primary key default gen_random_uuid(),
  internal_ref text unique,
  customer_po_id uuid not null references public.customer_po (id) on delete cascade,
  partner_id uuid not null references public.partner (id),
  po_date date not null default current_date,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'acknowledged', 'completed', 'cancelled')),
  approval_id uuid references public.approval (id) on delete set null,
  notes text,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists supplier_po_customer_po_idx on public.supplier_po (customer_po_id);

create or replace function public.set_supplier_po_ref()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.internal_ref is null or btrim(new.internal_ref) = '' then
    new.internal_ref := public.next_ref('SPO');
  end if;
  return new;
end;
$$;

drop trigger if exists supplier_po_set_ref on public.supplier_po;
create trigger supplier_po_set_ref
  before insert on public.supplier_po
  for each row execute function public.set_supplier_po_ref();

create table if not exists public.supplier_po_line (
  id uuid primary key default gen_random_uuid(),
  supplier_po_id uuid not null references public.supplier_po (id) on delete cascade,
  po_line_id uuid not null references public.po_line (id),
  requirement_line_id uuid not null references public.requirement_line (id),
  commitment_id uuid references public.quantity_commitment (id) on delete set null,
  qty numeric(14, 3) not null check (qty > 0),
  unit_cost numeric(14, 4) check (unit_cost is null or unit_cost >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_po_id, po_line_id)
);

create index if not exists supplier_po_line_spo_idx on public.supplier_po_line (supplier_po_id);
create index if not exists supplier_po_line_po_line_idx on public.supplier_po_line (po_line_id);

-- Derive the requirement line and enforce the approved-selection rule.
create or replace function public.check_supplier_po_line()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req_line uuid;
  v_partner uuid;
  v_approval uuid;
  v_approved boolean;
begin
  select requirement_line_id into v_req_line from public.po_line where id = new.po_line_id;
  if v_req_line is null then
    raise exception 'FR-SPO-01: the supplier PO line must reference a customer PO line';
  end if;
  new.requirement_line_id := v_req_line;

  select partner_id, approval_id into v_partner, v_approval
  from public.supplier_po where id = new.supplier_po_id;

  select exists (
    select 1 from public.oem_selection s
    where s.requirement_line_id = v_req_line
      and s.partner_id = v_partner
      and s.status = 'approved'
  ) into v_approved;

  if not v_approved then
    if v_approval is null
       or not exists (
         select 1 from public.approval a
         where a.id = v_approval and a.decision = 'approved'
       ) then
      raise exception
        'FR-SPO-01: partner is not the approved OEM selection; an owner approval is required';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists supplier_po_line_check on public.supplier_po_line;
create trigger supplier_po_line_check
  before insert or update on public.supplier_po_line
  for each row execute function public.check_supplier_po_line();

-- ---------------------------------------------------------------------------
-- PO-level coverage
-- ---------------------------------------------------------------------------
create or replace view public.v_po_line_coverage
with (security_invoker = true) as
select
  pl.id                              as po_line_id,
  pl.customer_po_id                  as customer_po_id,
  pl.requirement_line_id             as requirement_line_id,
  pl.qty_ordered_effective           as qty_ordered,
  coalesce(sum(spl.qty), 0)          as qty_covered,
  greatest(0, pl.qty_ordered_effective - coalesce(sum(spl.qty), 0)) as qty_uncovered
from public.po_line pl
left join public.supplier_po_line spl on spl.po_line_id = pl.id
group by pl.id, pl.customer_po_id, pl.requirement_line_id, pl.qty_ordered_effective;

grant select on public.v_po_line_coverage to authenticated;

-- ---------------------------------------------------------------------------
-- Audit, updated_at, row_version and RLS
-- ---------------------------------------------------------------------------
create or replace function public.stamp_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.updated_by := coalesce(new.updated_by, auth.uid());
  elsif tg_op = 'UPDATE' then
    new.updated_by := coalesce(new.updated_by, auth.uid());
  end if;
  return new;
end;
$$;

do $$
declare
  t text;
  v_has_created boolean;
begin
  foreach t in array array['supplier_po', 'supplier_po_line'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t, t);
    execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);

    select exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='row_version'
    ) into v_has_created;
    if v_has_created then
      execute format('drop trigger if exists %I_row_version on public.%I', t, t);
      execute format('create trigger %I_row_version before update on public.%I for each row execute function public.bump_row_version()', t, t);
    end if;

    select exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='created_by'
    ) into v_has_created;
    if v_has_created then
      execute format('drop trigger if exists %I_stamp_actor on public.%I', t, t);
      execute format('create trigger %I_stamp_actor before insert or update on public.%I for each row execute function public.stamp_actor()', t, t);
    end if;
  end loop;
end
$$;

do $$
declare
  t text;
  v_write text := 'public.has_any_role(array[''owner'',''sales'',''operations'',''admin'']::public.app_role[])';
begin
  foreach t in array array['supplier_po', 'supplier_po_line'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select to authenticated using (true)', t, t);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (%s)', t, t, v_write);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated using (%s) with check (%s)', t, t, v_write, v_write);
    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (%s)', t, t, v_write);
  end loop;
end
$$;

grant select, insert, update, delete on public.supplier_po to authenticated;
grant select, insert, update, delete on public.supplier_po_line to authenticated;

-- >>> supabase/migrations/0024_tile_d05.sql
-- Defence Contract CRM â€” Phase 7: Orders-pending tile D-05 (T7.6)
-- Customer POs by status, with a matching drill-down list (FR-DASH-01).
-- Idempotent. Depends on 0023_supplier_po.sql.

create or replace view public.v_tile_d05
with (security_invoker = true) as
select
  po.id                         as customer_po_id,
  po.internal_ref               as internal_ref,
  po.customer_id                as customer_id,
  c.name                        as customer_name,
  po.status                     as status,
  po.po_date                    as po_date,
  coalesce(sum(pl.qty_ordered_effective * pl.unit_rate), 0) as amount,
  po.created_at                 as created_at
from public.customer_po po
join public.customer c on c.id = po.customer_id
left join public.po_line pl on pl.customer_po_id = po.id
group by po.id, po.internal_ref, po.customer_id, c.name, po.status, po.po_date, po.created_at;

grant select on public.v_tile_d05 to authenticated;

create or replace view public.v_dashboard_kpis
with (security_invoker = true) as
select 'D-01'::text as tile_code, count(*)::bigint as count_value, 0::numeric as amount_value,
       '{}'::jsonb as qty_by_uom, 0::bigint as excluded_missing_count, now() as as_of
from public.v_tile_d01
union all
select 'D-02', count(*)::bigint, 0::numeric, '{}'::jsonb, 0::bigint, now() from public.v_tile_d02
union all
select 'D-03', count(*)::bigint, 0::numeric, '{}'::jsonb, 0::bigint, now() from public.v_tile_d03
union all
select
  'D-05'::text,
  count(*)::bigint,
  coalesce(sum(amount), 0)::numeric,
  '{}'::jsonb,
  0::bigint,
  now()
from public.v_tile_d05
union all
select
  'D-08'::text,
  (select count(*) from public.v_tile_d08)::bigint,
  0::numeric,
  coalesce(
    (select jsonb_object_agg(x.uom, x.total)
     from (select uom, sum(qty_uncovered) as total from public.v_tile_d08 group by uom) x),
    '{}'::jsonb),
  0::bigint,
  now();

grant select on public.v_dashboard_kpis to authenticated;

-- Ask PostgREST to pick up the new functions and views immediately.
notify pgrst, 'reload schema';
