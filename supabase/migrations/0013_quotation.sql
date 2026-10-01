-- Defence Contract CRM — Phase 5: Quotation schema and immutability (T5.1)
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
