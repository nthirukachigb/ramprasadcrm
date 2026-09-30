-- ===========================================================================
-- Defence Contract CRM - Phase 3 (OEM sourcing) - APPLY MANUALLY
-- ---------------------------------------------------------------------------
-- Run APPLY_MANUALLY_PHASE2.sql first, then paste this file into the Supabase
-- SQL Editor (Dashboard > SQL Editor) and run it. Idempotent (safe to re-run).
--   0009_sourcing.sql  (T3.1)
-- ===========================================================================

-- >>> supabase/migrations/0009_sourcing.sql
-- Defence Contract CRM â€” Phase 3: OEM sourcing (T3.1)
-- The whole OEM request/response cycle, keeping availability (indication) and
-- firm commitment in separate tables so an "800 available, 0 committed" reply
-- never counts as coverage.
-- Idempotent. Depends on 0003_requirements.sql and 0004_documents.sql.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'sourcing_request_status') then
    create type public.sourcing_request_status as enum
      ('draft', 'sent', 'responded', 'partially_responded', 'declined',
       'overdue', 'cancelled');
  end if;
  if not exists (select 1 from pg_type where typname = 'oem_response_status') then
    create type public.oem_response_status as enum
      ('received', 'under_evaluation', 'accepted_for_quotation', 'rejected', 'superseded');
  end if;
  if not exists (select 1 from pg_type where typname = 'commitment_status') then
    create type public.commitment_status as enum
      ('active', 'changed', 'withdrawn', 'expired', 'consumed');
  end if;
  if not exists (select 1 from pg_type where typname = 'oem_selection_status') then
    create type public.oem_selection_status as enum ('proposed', 'approved', 'rejected');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Shortlist (T3.2 writes here only after a person confirms)
-- ---------------------------------------------------------------------------
create table if not exists public.sourcing_shortlist (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.requirement (id) on delete cascade,
  requirement_line_id uuid not null references public.requirement_line (id) on delete cascade,
  partner_id uuid not null references public.partner (id) on delete restrict,
  suggestion_source text not null default 'user'
    check (suggestion_source in ('system', 'user')),
  suggested_by uuid,
  confirmed_by uuid,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (requirement_line_id, partner_id)
);

create index if not exists sourcing_shortlist_requirement_idx
  on public.sourcing_shortlist (requirement_id);

-- ---------------------------------------------------------------------------
-- 3. Sourcing request
-- ---------------------------------------------------------------------------
create table if not exists public.sourcing_request (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.requirement (id) on delete cascade,
  partner_id uuid not null references public.partner (id) on delete restrict,
  request_date date not null default current_date,
  response_due_date date,
  channel text,
  sent_by uuid,
  status public.sourcing_request_status not null default 'draft',
  notes text,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sourcing_request_requirement_idx
  on public.sourcing_request (requirement_id);
create index if not exists sourcing_request_partner_idx
  on public.sourcing_request (partner_id);

create table if not exists public.sourcing_request_line (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.sourcing_request (id) on delete cascade,
  requirement_line_id uuid not null references public.requirement_line (id) on delete cascade,
  qty_requested numeric(14, 3) not null check (qty_requested > 0),
  created_at timestamptz not null default now(),
  unique (request_id, requirement_line_id)
);

-- ---------------------------------------------------------------------------
-- 4. OEM response
-- ---------------------------------------------------------------------------
create table if not exists public.oem_response (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.sourcing_request (id) on delete cascade,
  partner_id uuid not null references public.partner (id) on delete restrict,
  response_date date not null default current_date,
  partner_quotation_no text,
  status public.oem_response_status not null default 'received',
  received_by uuid,
  notes text,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists oem_response_request_idx on public.oem_response (request_id);

create table if not exists public.oem_response_line (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references public.oem_response (id) on delete cascade,
  sourcing_request_line_id uuid not null
    references public.sourcing_request_line (id) on delete cascade,
  unit_price numeric(14, 4) check (unit_price is null or unit_price >= 0),
  currency text not null default 'INR',
  freight_unit numeric(14, 4) check (freight_unit is null or freight_unit >= 0),
  lead_time_days integer check (lead_time_days is null or lead_time_days >= 0),
  moq numeric(14, 3) check (moq is null or moq >= 0),
  validity_until date,
  delivery_terms text,
  deviations text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (response_id, sourcing_request_line_id)
);

-- Informational availability. Never treated as coverage (FR-QTY-02).
create table if not exists public.quantity_indication (
  id uuid primary key default gen_random_uuid(),
  response_line_id uuid not null
    references public.oem_response_line (id) on delete cascade,
  qty_available_indicated numeric(14, 3) not null
    check (qty_available_indicated > 0),
  indicated_date date not null default current_date,
  valid_until date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists quantity_indication_line_idx
  on public.quantity_indication (response_line_id);

-- ---------------------------------------------------------------------------
-- 5. Firm commitment (versioned; evidence required)
-- ---------------------------------------------------------------------------
create table if not exists public.quantity_commitment (
  id uuid primary key default gen_random_uuid(),
  requirement_line_id uuid not null
    references public.requirement_line (id) on delete cascade,
  partner_id uuid not null references public.partner (id) on delete restrict,
  response_line_id uuid references public.oem_response_line (id) on delete set null,
  qty_committed numeric(14, 3) not null check (qty_committed > 0),
  commitment_date date not null default current_date,
  valid_until date,
  evidence_document_id uuid references public.document (id) on delete set null,
  evidence_note text,
  version integer not null default 1 check (version > 0),
  status public.commitment_status not null default 'active',
  supersedes_id uuid references public.quantity_commitment (id) on delete set null,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commitment_evidence_chk check (
    evidence_document_id is not null
    or (evidence_note is not null and length(btrim(evidence_note)) >= 3)
  ),
  constraint commitment_validity_chk check (
    valid_until is null or valid_until >= commitment_date
  )
);

create index if not exists quantity_commitment_line_idx
  on public.quantity_commitment (requirement_line_id);
create index if not exists quantity_commitment_active_idx
  on public.quantity_commitment (requirement_line_id, status)
  where status = 'active';

-- ---------------------------------------------------------------------------
-- 6. OEM selection (approved through the approval framework)
-- ---------------------------------------------------------------------------
create table if not exists public.oem_selection (
  id uuid primary key default gen_random_uuid(),
  requirement_line_id uuid not null
    references public.requirement_line (id) on delete cascade,
  partner_id uuid not null references public.partner (id) on delete restrict,
  qty_allocated numeric(14, 3) not null check (qty_allocated > 0),
  status public.oem_selection_status not null default 'proposed',
  approval_id uuid references public.approval (id) on delete set null,
  -- Populated in T4.2 (coverage_override). Nullable until then.
  coverage_override_id uuid,
  notes text,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint selection_approval_chk check (
    status <> 'approved' or approval_id is not null
  )
);

create index if not exists oem_selection_line_idx
  on public.oem_selection (requirement_line_id);

-- ---------------------------------------------------------------------------
-- 7. pending_notification (formalised in T6.2; used by the change trigger)
-- ---------------------------------------------------------------------------
create table if not exists public.pending_notification (
  id uuid primary key default gen_random_uuid(),
  notification_type text not null,
  subject_type text,
  subject_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now()
);

-- Idempotent add for databases that applied the first version of this file.
alter table public.pending_notification
  add column if not exists updated_by uuid;

-- ---------------------------------------------------------------------------
-- 8. Firm-commitment quantity (the T4.1 definition)
-- ---------------------------------------------------------------------------
create or replace function public.committed_qty(
  p_requirement_line_id uuid,
  p_as_of date default current_date
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(qc.qty_committed), 0)
  from public.quantity_commitment qc
  where qc.requirement_line_id = p_requirement_line_id
    and qc.status = 'active'
    and qc.commitment_date <= p_as_of
    and (qc.valid_until is null or qc.valid_until >= p_as_of);
$$;

create or replace function public.committed_qty_for_partner(
  p_requirement_line_id uuid,
  p_partner_id uuid,
  p_as_of date default current_date
)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(qc.qty_committed), 0)
  from public.quantity_commitment qc
  where qc.requirement_line_id = p_requirement_line_id
    and qc.partner_id = p_partner_id
    and qc.status = 'active'
    and qc.commitment_date <= p_as_of
    and (qc.valid_until is null or qc.valid_until >= p_as_of);
$$;

grant execute on function public.committed_qty(uuid, date) to authenticated;
grant execute on function public.committed_qty_for_partner(uuid, uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Partner suggestion (read-only; labelled "suggestion", FR-SOURCE-01)
-- ---------------------------------------------------------------------------
create or replace function public.suggest_partners(p_requirement_id uuid)
returns table (
  requirement_line_id uuid,
  line_no integer,
  product_id uuid,
  match_basis text,
  partner_id uuid,
  partner_name text,
  relationship_type public.partner_relationship_type,
  exclusive_representation boolean,
  approved_source boolean,
  lead_time_days integer,
  moq numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with line_product as (
    select
      rl.id                       as line_id,
      rl.line_no                  as line_no,
      coalesce(rl.product_id, pn.product_id) as product_id,
      case
        when rl.product_id is not null then 'line product'
        else 'part number match'
      end                         as match_basis
    from public.requirement_line rl
    left join lateral (
      select pn.product_id
      from public.part_number pn
      where pn.is_active
        and pn.value_normalized in (
          lower(regexp_replace(btrim(coalesce(rl.internal_part_no, '')), '\s+', ' ', 'g')),
          lower(regexp_replace(btrim(coalesce(rl.customer_part_no, '')), '\s+', ' ', 'g')),
          lower(regexp_replace(btrim(coalesce(rl.oem_part_no, '')), '\s+', ' ', 'g'))
        )
      limit 1
    ) pn on rl.product_id is null
    where rl.requirement_id = p_requirement_id
  )
  select
    lp.line_id,
    lp.line_no,
    lp.product_id,
    lp.match_basis,
    pp.partner_id,
    pt.name,
    pp.relationship_type,
    pp.exclusive_representation,
    pp.approved_source,
    pp.lead_time_days,
    pp.moq
  from line_product lp
  join public.partner_product pp
    on pp.product_id = lp.product_id and pp.is_active
  join public.partner pt on pt.id = pp.partner_id and pt.is_active
  order by lp.line_no, pp.approved_source desc, pt.name;
$$;

grant execute on function public.suggest_partners(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Commitment guards and versioned changes (T3.4 groundwork in T3.1)
-- ---------------------------------------------------------------------------
-- A committed quantity cannot be edited in place; use change_commitment.
create or replace function public.block_commitment_qty_edit()
returns trigger
language plpgsql
as $$
begin
  if new.qty_committed is distinct from old.qty_committed
     and coalesce(current_setting('app.commitment_change_approved', true), '') <> 'on' then
    raise exception
      'COMMITMENT_VERSION_REQUIRED: change the quantity through change_commitment, which creates a new version';
  end if;
  return new;
end;
$$;

drop trigger if exists quantity_commitment_block_qty on public.quantity_commitment;
create trigger quantity_commitment_block_qty
  before update on public.quantity_commitment
  for each row execute function public.block_commitment_qty_edit();

create or replace function public.change_commitment(
  p_id uuid,
  p_new_qty numeric,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.quantity_commitment;
  v_new uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_new_qty is null or p_new_qty <= 0 then
    raise exception 'The new committed quantity must be greater than zero';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'A reason of at least 3 characters is required';
  end if;

  select * into v_old from public.quantity_commitment where id = p_id for update;
  if not found then
    raise exception 'Commitment not found';
  end if;
  if v_old.status <> 'active' then
    raise exception 'Only an active commitment can be changed';
  end if;

  update public.quantity_commitment
     set status = 'changed', updated_at = now()
   where id = p_id;

  insert into public.quantity_commitment (
    requirement_line_id, partner_id, response_line_id, qty_committed,
    commitment_date, valid_until, evidence_document_id, evidence_note,
    version, status, supersedes_id
  )
  values (
    v_old.requirement_line_id, v_old.partner_id, v_old.response_line_id, p_new_qty,
    v_old.commitment_date, v_old.valid_until, v_old.evidence_document_id, v_old.evidence_note,
    v_old.version + 1, 'active', v_old.id
  )
  returning id into v_new;

  perform set_config('app.audit_reason', p_reason, true);
  return v_new;
end;
$$;

create or replace function public.withdraw_commitment(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.commitment_status;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'A reason of at least 3 characters is required';
  end if;

  select status into v_status from public.quantity_commitment where id = p_id for update;
  if not found then
    raise exception 'Commitment not found';
  end if;
  if v_status <> 'active' then
    raise exception 'Only an active commitment can be withdrawn';
  end if;

  update public.quantity_commitment
     set status = 'withdrawn', updated_at = now()
   where id = p_id;

  perform set_config('app.audit_reason', p_reason, true);
end;
$$;

grant execute on function public.change_commitment(uuid, numeric, text) to authenticated;
grant execute on function public.withdraw_commitment(uuid, text) to authenticated;

-- Queue a notification when coverage drops (a later task delivers it).
create or replace function public.notify_commitment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('changed', 'withdrawn')
     and old.status is distinct from new.status then
    insert into public.pending_notification
      (notification_type, subject_type, subject_id, payload)
    values (
      'commitment_' || new.status,
      'quantity_commitment',
      new.id,
      jsonb_build_object(
        'requirement_line_id', new.requirement_line_id,
        'partner_id', new.partner_id,
        'old_qty', old.qty_committed,
        'new_qty', new.qty_committed,
        'version', new.version
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists quantity_commitment_notify on public.quantity_commitment;
create trigger quantity_commitment_notify
  after update on public.quantity_commitment
  for each row execute function public.notify_commitment_change();

-- An allocation must not exceed the firm commitment unless an override exists.
create or replace function public.enforce_selection_allocation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_committed numeric;
  v_other numeric;
begin
  if new.coverage_override_id is not null then
    return new;
  end if;

  v_committed := public.committed_qty(new.requirement_line_id, current_date);

  select coalesce(sum(s.qty_allocated), 0) into v_other
  from public.oem_selection s
  where s.requirement_line_id = new.requirement_line_id
    and s.status <> 'rejected'
    and (new.id is null or s.id <> new.id);

  if v_other + new.qty_allocated > v_committed then
    raise exception
      'SELECTION_EXCEEDS_COMMITMENT: allocation % exceeds firm commitment %',
      v_other + new.qty_allocated, v_committed;
  end if;
  return new;
end;
$$;

drop trigger if exists oem_selection_allocation on public.oem_selection;
create trigger oem_selection_allocation
  before insert or update on public.oem_selection
  for each row execute function public.enforce_selection_allocation();

-- ---------------------------------------------------------------------------
-- 11. Audit, updated_at, row_version and actor stamping
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
  v_has_updated boolean;
  v_has_version boolean;
  v_has_created boolean;
begin
  foreach t in array array[
    'sourcing_shortlist', 'sourcing_request', 'sourcing_request_line',
    'oem_response', 'oem_response_line', 'quantity_indication',
    'quantity_commitment', 'oem_selection', 'pending_notification'
  ] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format(
      'create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()',
      t, t);

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'updated_at'
    ) into v_has_updated;
    if v_has_updated then
      execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
      execute format(
        'create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()',
        t, t);
    end if;

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'row_version'
    ) into v_has_version;
    if v_has_version then
      execute format('drop trigger if exists %I_row_version on public.%I', t, t);
      execute format(
        'create trigger %I_row_version before update on public.%I for each row execute function public.bump_row_version()',
        t, t);
    end if;

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'created_by'
    ) into v_has_created;
    if v_has_created then
      execute format('drop trigger if exists %I_stamp_actor on public.%I', t, t);
      execute format(
        'create trigger %I_stamp_actor before insert or update on public.%I for each row execute function public.stamp_actor()',
        t, t);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 12. Row Level Security
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  v_write text := 'public.has_any_role(array[''owner'',''sales'',''operations'',''admin'']::public.app_role[])';
begin
  foreach t in array array[
    'sourcing_shortlist', 'sourcing_request', 'sourcing_request_line',
    'oem_response', 'oem_response_line', 'quantity_indication',
    'quantity_commitment', 'oem_selection', 'pending_notification'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (true)',
      t, t);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (%s)',
      t, t, v_write);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (%s) with check (%s)',
      t, t, v_write, v_write);
    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated using (%s)',
      t, t, v_write);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 13. Grants
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.sourcing_shortlist to authenticated;
grant select, insert, update, delete on public.sourcing_request to authenticated;
grant select, insert, update, delete on public.sourcing_request_line to authenticated;
grant select, insert, update, delete on public.oem_response to authenticated;
grant select, insert, update, delete on public.oem_response_line to authenticated;
grant select, insert, update, delete on public.quantity_indication to authenticated;
grant select, insert, update on public.quantity_commitment to authenticated;
grant select, insert, update, delete on public.oem_selection to authenticated;
grant select on public.pending_notification to authenticated;

