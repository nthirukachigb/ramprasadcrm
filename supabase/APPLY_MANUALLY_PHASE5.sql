-- ===========================================================================
-- Defence Contract CRM - Phase 5 (Quotations) - APPLY MANUALLY
-- ---------------------------------------------------------------------------
-- Run APPLY_MANUALLY_PHASE4.sql first, then paste this file into the Supabase
-- SQL Editor and run it. Idempotent (safe to re-run).
--   0013_quotation.sql  0014_quotation_workflow.sql  0015_bid_history.sql
-- ===========================================================================

-- >>> supabase/migrations/0013_quotation.sql
-- Defence Contract CRM â€” Phase 5: Quotation schema and immutability (T5.1)
-- A quotation always belongs to a requirement; its versions are immutable once
-- they leave Draft. Totals are calculated in the database.
-- Idempotent. Depends on 0010_coverage.sql and 0009_sourcing.sql.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'quotation_status') then
    create type public.quotation_status as enum (
      'draft', 'pending_approval', 'approved', 'rejected',
      'submitted', 'superseded', 'discarded', 'closed'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'quotation_version_reason') then
    create type public.quotation_version_reason as enum (
      'initial', 'revised', 'pnc', 'cost_change', 'clarification', 'other'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'tax_parent_type') then
    create type public.tax_parent_type as enum ('quotation_version');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. quotation
-- ---------------------------------------------------------------------------
create table if not exists public.quotation (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.requirement (id) on delete cascade,
  internal_quote_no text unique,
  oem_quote_no text,
  current_version_id uuid,  -- FK added after quotation_version exists
  notes text,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists quotation_requirement_idx on public.quotation (requirement_id);

create or replace function public.set_quotation_ref()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.internal_quote_no is null or btrim(new.internal_quote_no) = '' then
    new.internal_quote_no := public.next_ref('QT');
  end if;
  return new;
end;
$$;

drop trigger if exists quotation_set_ref on public.quotation;
create trigger quotation_set_ref
  before insert on public.quotation
  for each row execute function public.set_quotation_ref();

-- ---------------------------------------------------------------------------
-- 3. quotation_version
-- ---------------------------------------------------------------------------
create table if not exists public.quotation_version (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotation (id) on delete cascade,
  version_no integer not null check (version_no > 0),
  version_reason public.quotation_version_reason not null default 'initial',
  status public.quotation_status not null default 'draft',
  currency text not null default 'INR',
  fx_rate numeric(12, 6) not null default 1 check (fx_rate > 0),
  valid_until date,
  delivery_terms text,
  payment_terms text,
  technical_compliance_declared boolean not null default false,
  commercial_compliance_declared boolean not null default false,
  declared_by uuid,
  declared_at timestamptz,
  snapshot jsonb,
  approval_id uuid references public.approval (id) on delete set null,
  approved_by uuid,
  approved_at timestamptz,
  rejected_reason text,
  notes text,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quotation_id, version_no)
);

create index if not exists quotation_version_quotation_idx
  on public.quotation_version (quotation_id);
create index if not exists quotation_version_status_idx
  on public.quotation_version (status);

-- current_version_id FK (deferred because quotation_version is created after)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'quotation_current_version_fk') then
    alter table public.quotation
      add constraint quotation_current_version_fk
      foreign key (current_version_id)
      references public.quotation_version (id)
      on delete set null;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. quotation_line
-- ---------------------------------------------------------------------------
create table if not exists public.quotation_line (
  id uuid primary key default gen_random_uuid(),
  quotation_version_id uuid not null
    references public.quotation_version (id) on delete cascade,
  requirement_line_id uuid not null
    references public.requirement_line (id) on delete cascade,
  oem_response_line_id uuid
    references public.oem_response_line (id) on delete set null,
  qty_quoted numeric(14, 3) not null check (qty_quoted > 0),
  uom text not null,
  unit_cost numeric(14, 4) check (unit_cost is null or unit_cost >= 0),
  freight_unit numeric(14, 4) check (freight_unit is null or freight_unit >= 0),
  other_cost_unit numeric(14, 4) check (other_cost_unit is null or other_cost_unit >= 0),
  target_margin_pct numeric(7, 4) check (target_margin_pct is null or target_margin_pct >= 0),
  proposed_unit_price numeric(14, 4) not null check (proposed_unit_price > 0),
  lead_time_days integer check (lead_time_days is null or lead_time_days >= 0),
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quotation_version_id, requirement_line_id)
);

create index if not exists quotation_line_version_idx
  on public.quotation_line (quotation_version_id);
create index if not exists quotation_line_requirement_line_idx
  on public.quotation_line (requirement_line_id);

-- A quotation line must reference a line of the quotation's own requirement.
create or replace function public.check_quotation_line_requirement()
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
    from public.requirement_line rl
    join public.quotation_version qv on qv.id = new.quotation_version_id
    join public.quotation q on q.id = qv.quotation_id
    where rl.id = new.requirement_line_id
      and rl.requirement_id = q.requirement_id
  ) into v_match;

  if not v_match then
    raise exception
      'BR-01: a quotation line must belong to a line of the quotation''s requirement';
  end if;
  return new;
end;
$$;

drop trigger if exists quotation_line_requirement on public.quotation_line;
create trigger quotation_line_requirement
  before insert or update on public.quotation_line
  for each row execute function public.check_quotation_line_requirement();

-- ---------------------------------------------------------------------------
-- 5. tax_line
-- ---------------------------------------------------------------------------
create table if not exists public.tax_line (
  id uuid primary key default gen_random_uuid(),
  parent_type public.tax_parent_type not null,
  parent_id uuid not null,
  tax_type text not null,
  rate_pct numeric(7, 4) check (rate_pct is null or rate_pct >= 0),
  taxable_amount numeric(14, 2) check (taxable_amount is null or taxable_amount >= 0),
  amount numeric(14, 2) not null check (amount >= 0),
  sort_order integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tax_line_parent_idx on public.tax_line (parent_type, parent_id);

-- ---------------------------------------------------------------------------
-- 6. Immutability (BR-19, BR-23)
-- ---------------------------------------------------------------------------
-- A version that has left Draft cannot be edited (approval RPCs set the flag).
create or replace function public.block_locked_quotation_version()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'draft'
     and coalesce(current_setting('app.quotation_unlocked', true), '') <> 'on' then
    raise exception 'BR-19: an approved quotation version is immutable; create a revision instead';
  end if;
  return new;
end;
$$;

drop trigger if exists quotation_version_immutable on public.quotation_version;
create trigger quotation_version_immutable
  before update on public.quotation_version
  for each row execute function public.block_locked_quotation_version();

-- Lines and taxes may only be changed while their version is Draft.
create or replace function public.block_locked_quotation_child()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version uuid := coalesce(new.quotation_version_id, old.quotation_version_id);
  v_status public.quotation_status;
begin
  select status into v_status from public.quotation_version where id = v_version;
  if v_status is null then
    return coalesce(new, old);
  end if;
  if v_status <> 'draft'
     and coalesce(current_setting('app.quotation_unlocked', true), '') <> 'on' then
    raise exception 'BR-19: lines of an approved quotation version are immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists quotation_line_immutable on public.quotation_line;
create trigger quotation_line_immutable
  before insert or update or delete on public.quotation_line
  for each row execute function public.block_locked_quotation_child();

-- tax_line is polymorphic; only quotation_version is supported in Phase 5.
create or replace function public.block_locked_tax_line()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.quotation_status;
begin
  if coalesce(new.parent_type, old.parent_type) <> 'quotation_version' then
    return coalesce(new, old);
  end if;
  select status into v_status
  from public.quotation_version
  where id = coalesce(new.parent_id, old.parent_id);
  if v_status <> 'draft'
     and coalesce(current_setting('app.quotation_unlocked', true), '') <> 'on' then
    raise exception 'BR-19: tax lines of an approved quotation version are immutable';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists tax_line_immutable on public.tax_line;
create trigger tax_line_immutable
  before insert or update or delete on public.tax_line
  for each row execute function public.block_locked_tax_line();

-- ---------------------------------------------------------------------------
-- 7. Views: totals, operations (no cost/margin), margin (role-gated)
-- ---------------------------------------------------------------------------
create or replace view public.v_quotation_totals
with (security_invoker = true) as
with lines as (
  select
    ql.quotation_version_id,
    sum(ql.qty_quoted * ql.proposed_unit_price) as net_amount,
    sum(
      ql.qty_quoted * (
        coalesce(ql.unit_cost, 0)
        + coalesce(ql.freight_unit, 0)
        + coalesce(ql.other_cost_unit, 0)
      )
    ) as cost_amount,
    count(*) as line_count
  from public.quotation_line ql
  group by ql.quotation_version_id
),
taxes as (
  select parent_id as quotation_version_id, sum(amount) as tax_amount
  from public.tax_line
  where parent_type = 'quotation_version'
  group by parent_id
)
select
  qv.id                                     as quotation_version_id,
  qv.quotation_id                           as quotation_id,
  qv.version_no                             as version_no,
  qv.status                                 as status,
  coalesce(l.line_count, 0)                 as line_count,
  coalesce(l.net_amount, 0)                 as net_amount,
  coalesce(l.cost_amount, 0)                as cost_amount,
  coalesce(t.tax_amount, 0)                 as tax_amount,
  coalesce(l.net_amount, 0) + coalesce(t.tax_amount, 0) as gross_amount,
  case
    when coalesce(l.net_amount, 0) > 0
      then (l.net_amount - l.cost_amount) / l.net_amount * 100
    else null
  end                                       as margin_pct
from public.quotation_version qv
left join lines l on l.quotation_version_id = qv.id
left join taxes t on t.quotation_version_id = qv.id;

grant select on public.v_quotation_totals to authenticated;

-- Operations-safe line view: no cost, freight, other cost or margin.
create or replace view public.v_quotation_line_ops
with (security_invoker = true) as
select
  ql.id                     as id,
  ql.quotation_version_id   as quotation_version_id,
  ql.requirement_line_id    as requirement_line_id,
  ql.qty_quoted             as qty_quoted,
  ql.uom                    as uom,
  ql.proposed_unit_price    as proposed_unit_price,
  ql.lead_time_days         as lead_time_days,
  ql.sort_order             as sort_order
from public.quotation_line ql;

grant select on public.v_quotation_line_ops to authenticated;

-- Margin-bearing view: Owner / Sales / Admin only. Operations gets no rows.
create or replace view public.v_quotation_line_margin
with (security_invoker = true) as
select
  ql.id                     as id,
  ql.quotation_version_id   as quotation_version_id,
  ql.requirement_line_id    as requirement_line_id,
  ql.qty_quoted             as qty_quoted,
  ql.unit_cost              as unit_cost,
  ql.freight_unit           as freight_unit,
  ql.other_cost_unit        as other_cost_unit,
  ql.target_margin_pct      as target_margin_pct,
  ql.proposed_unit_price    as proposed_unit_price,
  (
    case
      when ql.proposed_unit_price > 0 then
        (ql.proposed_unit_price - (
          coalesce(ql.unit_cost, 0)
          + coalesce(ql.freight_unit, 0)
          + coalesce(ql.other_cost_unit, 0)
        )) / ql.proposed_unit_price * 100
      else null
    end
  )                         as margin_pct
from public.quotation_line ql
where public.has_any_role(array['owner', 'sales', 'admin']::public.app_role[]);

grant select on public.v_quotation_line_margin to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Replace the coverage view to use the real quoted quantity (T5.1)
-- ---------------------------------------------------------------------------
create or replace view public.v_requirement_line_coverage
with (security_invoker = true) as
with q as (
  select ql.requirement_line_id, sum(ql.qty_quoted) as qty_quoted
  from public.quotation_line ql
  join public.quotation_version qv on qv.id = ql.quotation_version_id
  join public.quotation qt
    on qt.id = qv.quotation_id and qt.current_version_id = qv.id
  where qv.status in ('approved', 'submitted')
  group by ql.requirement_line_id
),
ind as (
  select
    srl.requirement_line_id,
    sum(qi.qty_available_indicated) as qty_indicated
  from public.quantity_indication qi
  join public.oem_response_line ol on ol.id = qi.response_line_id
  join public.sourcing_request_line srl on srl.id = ol.sourcing_request_line_id
  where qi.valid_until is null or qi.valid_until >= current_date
  group by srl.requirement_line_id
),
com as (
  select
    qc.requirement_line_id,
    sum(qc.qty_committed) as qty_committed
  from public.quantity_commitment qc
  where qc.status = 'active'
    and qc.commitment_date <= current_date
    and (qc.valid_until is null or qc.valid_until >= current_date)
  group by qc.requirement_line_id
)
select
  rl.id                                   as requirement_line_id,
  rl.requirement_id                       as requirement_id,
  rl.line_no                              as line_no,
  rl.description                          as description,
  rl.customer_part_no                     as customer_part_no,
  rl.internal_part_no                     as internal_part_no,
  rl.uom                                  as uom,
  rl.quantity_required                    as qty_required,
  coalesce(q.qty_quoted, rl.quantity_required)::numeric(14, 3) as qty_quoted,
  coalesce(ind.qty_indicated, 0)          as qty_indicated,
  coalesce(com.qty_committed, 0)          as qty_committed,
  greatest(
    0,
    coalesce(q.qty_quoted, rl.quantity_required) - coalesce(com.qty_committed, 0)
  )                                       as qty_uncovered,
  exists (
    select 1 from public.coverage_override co
    where co.requirement_line_id = rl.id and co.status = 'approved'
  )                                       as has_approved_override
from public.requirement_line rl
left join q on q.requirement_line_id = rl.id
left join ind on ind.requirement_line_id = rl.id
left join com on com.requirement_line_id = rl.id;

grant select on public.v_requirement_line_coverage to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Audit, updated_at, row_version and actor stamping
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
  foreach t in array array['quotation', 'quotation_version', 'quotation_line', 'tax_line'] loop
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
-- 10. Row Level Security
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  v_write text := 'public.has_any_role(array[''owner'',''sales'',''operations'',''admin'']::public.app_role[])';
begin
  foreach t in array array['quotation', 'quotation_version', 'quotation_line', 'tax_line'] loop
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
-- 11. Grants
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.quotation to authenticated;
grant select, insert, update, delete on public.quotation_version to authenticated;
grant select, insert, update, delete on public.quotation_line to authenticated;
grant select, insert, update, delete on public.tax_line to authenticated;

-- >>> supabase/migrations/0014_quotation_workflow.sql
-- Defence Contract CRM â€” Phase 5: Quotation workflow (T5.2â€“T5.4, T5.6 DB)
-- Create-from-requirement, the approval gate, revisions and submission.
-- Idempotent. Depends on 0013_quotation.sql.

-- ---------------------------------------------------------------------------
-- 1. Columns the builder and submission record need
-- ---------------------------------------------------------------------------
alter table public.quotation_line
  alter column proposed_unit_price drop not null;
alter table public.quotation_line
  drop constraint if exists quotation_line_proposed_unit_price_check;
alter table public.quotation_line
  add constraint quotation_line_proposed_unit_price_check
  check (proposed_unit_price is null or proposed_unit_price > 0);
alter table public.quotation_line
  add column if not exists sourcing_basis text
  check (sourcing_basis is null or sourcing_basis in ('oem_selected', 'customer_supplied', 'in_house'));

alter table public.quotation_version
  add column if not exists submitted_at timestamptz;
alter table public.quotation_version
  add column if not exists submission_mode text;
alter table public.quotation_version
  add column if not exists submission_ref text;
alter table public.quotation_version
  add column if not exists late_reason text;

-- ---------------------------------------------------------------------------
-- 2. Create a quotation + first draft version from a requirement (T5.2)
-- ---------------------------------------------------------------------------
create or replace function public.create_quotation_from_requirement(
  p_requirement_id uuid,
  p_line_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quotation uuid;
  v_version uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.has_any_role(
    array['owner', 'sales', 'operations', 'admin']::public.app_role[]
  ) then
    raise exception 'FORBIDDEN: you may not create a quotation';
  end if;
  if not exists (select 1 from public.requirement where id = p_requirement_id) then
    raise exception 'Requirement not found';
  end if;

  insert into public.quotation (requirement_id, created_by, updated_by)
  values (p_requirement_id, auth.uid(), auth.uid())
  returning id into v_quotation;

  insert into public.quotation_version
    (quotation_id, version_no, version_reason, status, created_by, updated_by)
  values (v_quotation, 1, 'initial', 'draft', auth.uid(), auth.uid())
  returning id into v_version;

  update public.quotation
     set current_version_id = v_version
   where id = v_quotation;

  -- One quotation line per selected requirement line. The OEM cost is linked
  -- from any OEM response for that line; the price is set by the builder.
  insert into public.quotation_line
    (
      quotation_version_id, requirement_line_id, oem_response_line_id,
      qty_quoted, uom, unit_cost, proposed_unit_price, sort_order
    )
  select
    v_version,
    rl.id,
    cost.oem_response_line_id,
    rl.quantity_required,
    rl.uom,
    cost.unit_price,
    null,
    rl.line_no
  from public.requirement_line rl
  left join lateral (
    select ol.id as oem_response_line_id, ol.unit_price
    from public.sourcing_request_line srl
    join public.oem_response_line ol on ol.sourcing_request_line_id = srl.id
    where srl.requirement_line_id = rl.id
      and ol.unit_price is not null
    order by ol.unit_price asc
    limit 1
  ) cost on true
  where rl.requirement_id = p_requirement_id
    and (p_line_ids is null or rl.id = any (p_line_ids));

  return v_version;
end;
$$;

grant execute on function public.create_quotation_from_requirement(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Approval gate (T5.3, FR-QUOTE-06, FR-QTY-04, FR-RFI-05, FR-SOURCE-05)
-- ---------------------------------------------------------------------------
create or replace function public.quotation_gate_errors(p_version_id uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req uuid;
  v_errors text[] := '{}';
  v_n integer;
begin
  select q.requirement_id into v_req
  from public.quotation_version qv
  join public.quotation q on q.id = qv.quotation_id
  where qv.id = p_version_id;

  if v_req is null then
    raise exception 'Quotation version not found';
  end if;

  select count(*) into v_n
  from public.v_requirement_line_coverage c
  where c.requirement_id = v_req
    and c.qty_uncovered > 0
    and not c.has_approved_override;
  if v_n > 0 then
    v_errors := v_errors || format(
      'FR-QTY-04: %s line(s) have uncovered quantity without an approved override', v_n);
  end if;

  select count(*) into v_n
  from public.checklist_item ci
  where ci.requirement_id = v_req
    and ci.is_mandatory
    and ci.status not in ('attached', 'waived');
  if v_n > 0 then
    v_errors := v_errors || format(
      'FR-RFI-05: %s mandatory checklist item(s) are open', v_n);
  end if;

  select count(*) into v_n
  from public.quotation_line ql
  where ql.quotation_version_id = p_version_id
    and ql.proposed_unit_price is null;
  if v_n > 0 then
    v_errors := v_errors || format(
      'FR-QUOTE-03: %s line(s) have no proposed price', v_n);
  end if;

  select count(*) into v_n
  from public.quotation_line ql
  where ql.quotation_version_id = p_version_id
    and ql.sourcing_basis is null;
  if v_n > 0 then
    v_errors := v_errors || format(
      'FR-SOURCE-05: %s line(s) have no sourcing basis (OEM / customer-supplied / in-house)', v_n);
  end if;

  select count(*) into v_n
  from public.quotation_line ql
  where ql.quotation_version_id = p_version_id
    and ql.sourcing_basis = 'oem_selected'
    and not exists (
      select 1 from public.oem_selection s
      where s.requirement_line_id = ql.requirement_line_id
        and s.status = 'approved'
    );
  if v_n > 0 then
    v_errors := v_errors || format(
      'FR-SOURCE-05: %s line(s) have no approved OEM selection', v_n);
  end if;

  select count(*) into v_n
  from public.quotation_line ql
  where ql.quotation_version_id = p_version_id
    and ql.sourcing_basis = 'oem_selected'
    and ql.unit_cost is null;
  if v_n > 0 then
    v_errors := v_errors || format(
      'FR-QUOTE-03: %s OEM-selected line(s) have no OEM cost', v_n);
  end if;

  return v_errors;
end;
$$;

grant execute on function public.quotation_gate_errors(uuid) to authenticated;

create or replace function public.submit_quote_for_approval(p_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.quotation_status;
  v_errors text[];
  v_approval uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.has_any_role(
    array['owner', 'sales', 'operations', 'admin']::public.app_role[]
  ) then
    raise exception 'FORBIDDEN: you may not submit a quotation';
  end if;

  select status into v_status from public.quotation_version where id = p_version_id;
  if v_status is null then
    raise exception 'Quotation version not found';
  end if;
  if v_status <> 'draft' then
    raise exception 'Only a draft version can be submitted for approval';
  end if;

  v_errors := public.quotation_gate_errors(p_version_id);
  if array_length(v_errors, 1) is not null then
    raise exception 'QUOTE_GATE: %', array_to_string(v_errors, ' | ');
  end if;

  v_approval := public.request_approval(
    'quotation_version', p_version_id, 'Quotation approval requested');

  update public.quotation_version
     set status = 'pending_approval', approval_id = v_approval, updated_at = now()
   where id = p_version_id;

  return v_approval;
end;
$$;

grant execute on function public.submit_quote_for_approval(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Owner approval (T5.3) â€” locks the version and makes it current
-- ---------------------------------------------------------------------------
create or replace function public.approve_quotation_version(
  p_version_id uuid,
  p_comment text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version public.quotation_version;
  v_req uuid;
  v_errors text[];
  v_totals jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.has_any_role(array['owner', 'admin']::public.app_role[]) then
    raise exception 'FORBIDDEN: only the Owner or Admin may approve a quotation';
  end if;
  if p_comment is null or length(btrim(p_comment)) < 3 then
    raise exception 'An approval comment of at least 3 characters is required';
  end if;

  select * into v_version from public.quotation_version where id = p_version_id for update;
  if not found then
    raise exception 'Quotation version not found';
  end if;
  if v_version.status <> 'pending_approval' then
    raise exception 'Only a version pending approval can be approved';
  end if;

  v_errors := public.quotation_gate_errors(p_version_id);
  if array_length(v_errors, 1) is not null then
    raise exception 'QUOTE_GATE: %', array_to_string(v_errors, ' | ');
  end if;

  select q.requirement_id into v_req
  from public.quotation q where q.id = v_version.quotation_id;

  select to_jsonb(t) into v_totals
  from public.v_quotation_totals t
  where t.quotation_version_id = p_version_id;

  perform set_config('app.quotation_unlocked', 'on', true);

  -- Only one current version (PRD Â§21.5).
  update public.quotation_version
     set status = 'superseded', updated_at = now()
   where quotation_id = v_version.quotation_id
     and id <> p_version_id
     and status in ('approved', 'submitted');

  update public.quotation_version
     set status = 'approved',
         approved_by = auth.uid(),
         approved_at = now(),
         snapshot = v_totals,
         notes = coalesce(notes, '') || case when notes is null then '' else E'\n' end
                 || 'Approved: ' || p_comment,
         updated_at = now()
   where id = p_version_id;

  update public.quotation
     set current_version_id = p_version_id, updated_at = now()
   where id = v_version.quotation_id;

  if v_version.approval_id is not null then
    if exists (
      select 1 from public.approval
      where id = v_version.approval_id and decision = 'pending'
    ) then
      perform public.decide_approval(v_version.approval_id, 'approved', p_comment);
    end if;
  end if;

  -- An approved quotation moves an in-preparation requirement to Quoted.
  if exists (
    select 1 from public.requirement
    where id = v_req and status = 'in_preparation'
  ) then
    perform public.transition_requirement(v_req, 'quoted', 'Quotation approved');
  end if;
end;
$$;

grant execute on function public.approve_quotation_version(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Revisions (T5.4)
-- ---------------------------------------------------------------------------
create or replace function public.create_revision(
  p_version_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src public.quotation_version;
  v_new uuid;
  v_reason public.quotation_version_reason;
  v_next integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.has_any_role(
    array['owner', 'sales', 'operations', 'admin']::public.app_role[]
  ) then
    raise exception 'FORBIDDEN: you may not create a revision';
  end if;

  begin
    v_reason := p_reason::public.quotation_version_reason;
  exception when others then
    raise exception 'Invalid revision reason';
  end;

  select * into v_src from public.quotation_version where id = p_version_id;
  if not found then
    raise exception 'Quotation version not found';
  end if;
  if v_src.status not in ('approved', 'submitted', 'rejected', 'pending_approval') then
    raise exception 'A revision is created from an approved, submitted or rejected version';
  end if;

  select coalesce(max(version_no), 0) + 1 into v_next
  from public.quotation_version where quotation_id = v_src.quotation_id;

  insert into public.quotation_version
    (quotation_id, version_no, version_reason, status, currency, fx_rate, valid_until,
     delivery_terms, payment_terms, created_by, updated_by)
  values
    (v_src.quotation_id, v_next, v_reason, 'draft', v_src.currency, v_src.fx_rate,
     v_src.valid_until, v_src.delivery_terms, v_src.payment_terms, auth.uid(), auth.uid())
  returning id into v_new;

  insert into public.quotation_line
    (quotation_version_id, requirement_line_id, oem_response_line_id, qty_quoted, uom,
     unit_cost, freight_unit, other_cost_unit, target_margin_pct, proposed_unit_price,
     lead_time_days, sourcing_basis, notes, sort_order)
  select
    v_new, requirement_line_id, oem_response_line_id, qty_quoted, uom,
    unit_cost, freight_unit, other_cost_unit, target_margin_pct, proposed_unit_price,
    lead_time_days, sourcing_basis, notes, sort_order
  from public.quotation_line
  where quotation_version_id = p_version_id;

  update public.quotation
     set current_version_id = v_new, updated_at = now()
   where id = v_src.quotation_id;

  return v_new;
end;
$$;

grant execute on function public.create_revision(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Submission record (T5.6)
-- ---------------------------------------------------------------------------
create or replace function public.record_quotation_submission(
  p_version_id uuid,
  p_mode text,
  p_at timestamptz,
  p_ref text,
  p_proof_document_id uuid,
  p_late_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version public.quotation_version;
  v_req uuid;
  v_deadline timestamptz;
  v_status public.requirement_status;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.has_any_role(
    array['owner', 'sales', 'operations', 'admin']::public.app_role[]
  ) then
    raise exception 'FORBIDDEN: you may not record a submission';
  end if;

  select * into v_version from public.quotation_version where id = p_version_id for update;
  if not found then
    raise exception 'Quotation version not found';
  end if;
  if v_version.status <> 'approved' then
    raise exception 'Only an approved version can be submitted (FR-QUOTE-06)';
  end if;

  select requirement_id into v_req from public.quotation where id = v_version.quotation_id;
  select submission_deadline, status into v_deadline, v_status
  from public.requirement where id = v_req;

  if v_deadline is not null
     and p_at > v_deadline
     and (p_late_reason is null or length(btrim(p_late_reason)) < 3) then
    raise exception 'FR-QUOTE-07: a late submission needs a reason';
  end if;

  perform set_config('app.quotation_unlocked', 'on', true);
  update public.quotation_version
     set status = 'submitted',
         submitted_at = p_at,
         submission_mode = p_mode,
         submission_ref = p_ref,
         late_reason = p_late_reason,
         updated_at = now()
   where id = p_version_id;

  if p_proof_document_id is not null then
    insert into public.document_link (document_id, entity_type, entity_id, linked_by)
    values (p_proof_document_id, 'quotation', p_version_id, auth.uid())
    on conflict (document_id, entity_type, entity_id) do nothing;
  end if;

  if v_status = 'quoted' then
    perform public.transition_requirement(v_req, 'submitted', 'Quotation submitted');
  end if;
end;
$$;

grant execute on function public.record_quotation_submission(uuid, text, timestamptz, text, uuid, text) to authenticated;

-- >>> supabase/migrations/0015_bid_history.sql
-- Defence Contract CRM â€” Phase 5: Bid history (T5.5 DB)
-- Historical quotation lines for pricing context. Margin is exposed only to
-- Owner / Sales / Admin. Viewing the comparable panel is logged (metric G-08).
-- Idempotent. Depends on 0014_quotation_workflow.sql.

-- ---------------------------------------------------------------------------
-- 1. History view log
-- ---------------------------------------------------------------------------
create table if not exists public.history_view_log (
  id bigserial primary key,
  line_id uuid not null,
  viewed_by uuid,
  occurred_at timestamptz not null default now()
);

create index if not exists history_view_log_line_idx on public.history_view_log (line_id);
create index if not exists history_view_log_viewed_by_idx on public.history_view_log (viewed_by);

alter table public.history_view_log enable row level security;
drop policy if exists history_view_log_select on public.history_view_log;
create policy history_view_log_select on public.history_view_log
  for select to authenticated
  using (public.has_any_role(array['owner', 'admin']::public.app_role[]));

create or replace function public.log_history_view(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  insert into public.history_view_log (line_id, viewed_by)
  values (p_line_id, auth.uid());
end;
$$;

grant execute on function public.log_history_view(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. v_bid_history (no margin) â€” TECH-STACK Â§9.9
-- ---------------------------------------------------------------------------
create or replace view public.v_bid_history
with (security_invoker = true) as
select
  ql.id                       as quotation_line_id,
  ql.requirement_line_id      as requirement_line_id,
  rl.requirement_id           as requirement_id,
  r.internal_ref              as requirement_ref,
  r.customer_id               as customer_id,
  ql.quotation_version_id     as quotation_version_id,
  q.id                        as quotation_id,
  q.internal_quote_no         as internal_quote_no,
  qv.version_no               as version_no,
  qv.version_reason           as version_reason,
  qv.created_at               as version_date,
  qv.status                   as version_status,
  rl.product_id               as product_id,
  rl.part_no_norm             as part_no_norm,
  rl.description              as description,
  ql.qty_quoted               as qty_quoted,
  ql.uom                      as uom,
  ql.proposed_unit_price      as proposed_unit_price,
  ql.lead_time_days           as lead_time_days,
  rl.outcome                  as line_outcome,
  rl.loss_reason              as loss_reason,
  null::text                  as competitor,
  null::numeric(14, 4)        as winning_price,
  false                       as is_migrated,
  false                       as is_validated
from public.quotation_line ql
join public.quotation_version qv on qv.id = ql.quotation_version_id
join public.quotation q on q.id = qv.quotation_id
join public.requirement_line rl on rl.id = ql.requirement_line_id
join public.requirement r on r.id = rl.requirement_id;

grant select on public.v_bid_history to authenticated;

-- Margin-bearing history: Owner / Sales / Admin only.
create or replace view public.v_bid_history_with_margin
with (security_invoker = true) as
select
  bh.*,
  ql.unit_cost                as oem_cost_unit,
  ql.freight_unit             as freight_unit,
  ql.other_cost_unit          as other_cost_unit,
  case
    when ql.proposed_unit_price > 0 then
      (ql.proposed_unit_price - (
        coalesce(ql.unit_cost, 0)
        + coalesce(ql.freight_unit, 0)
        + coalesce(ql.other_cost_unit, 0)
      )) / ql.proposed_unit_price * 100
    else null
  end                         as margin_pct
from public.v_bid_history bh
join public.quotation_line ql on ql.id = bh.quotation_line_id
where public.has_any_role(array['owner', 'sales', 'admin']::public.app_role[]);

grant select on public.v_bid_history_with_margin to authenticated;

-- ---------------------------------------------------------------------------
-- 3. comparable_history(line_id) â€” exact / cross-reference / possible
-- ---------------------------------------------------------------------------
create or replace function public.comparable_history(p_line_id uuid)
returns table (
  quotation_line_id uuid,
  requirement_id uuid,
  requirement_ref text,
  version_no integer,
  proposed_unit_price numeric,
  line_outcome text,
  match_basis text
)
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select rl.id, rl.product_id, rl.part_no_norm, rl.description, rl.requirement_id
    from public.requirement_line rl
    where rl.id = p_line_id
  )
  select
    bh.quotation_line_id,
    bh.requirement_id,
    bh.requirement_ref,
    bh.version_no,
    bh.proposed_unit_price,
    bh.line_outcome,
    case
      when bh.requirement_line_id = t.id then 'exact'
      when bh.part_no_norm is not null and bh.part_no_norm = t.part_no_norm then 'exact'
      when bh.product_id is not null and bh.product_id = t.product_id then 'cross_reference'
      else 'possible'
    end as match_basis
  from public.v_bid_history bh
  cross join target t
  where bh.requirement_line_id <> t.id
    and (
      bh.part_no_norm = t.part_no_norm
      or bh.product_id = t.product_id
      or bh.description ilike '%' || t.description || '%'
      or t.description ilike '%' || bh.description || '%'
    )
  order by
    case
      when bh.part_no_norm = t.part_no_norm then 1
      when bh.product_id = t.product_id then 2
      else 3
    end,
    bh.version_date desc
  limit 50;
$$;

grant execute on function public.comparable_history(uuid) to authenticated;

-- Ask PostgREST to pick up the new functions and views immediately.
notify pgrst, 'reload schema';
