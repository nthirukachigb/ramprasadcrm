-- ===========================================================================
-- Defence Contract CRM - Phase 4 (Quantity coverage) - APPLY MANUALLY
-- ---------------------------------------------------------------------------
-- Run APPLY_MANUALLY_PHASE3.sql first, then paste this file into the Supabase
-- SQL Editor and run it. Idempotent (safe to re-run).
--   0010_coverage.sql  0011_coverage_override.sql  0012_tile_d08.sql
-- ===========================================================================

-- >>> supabase/migrations/0010_coverage.sql
-- Defence Contract CRM â€” Phase 4: Quantity coverage (T4.1)
-- The single source of truth for per-line coverage, calculated in the database
-- and read by every screen, tile and export (P10, FR-QTY-01â€¦03, BR-10/BR-11).
-- Idempotent. Depends on 0009_sourcing.sql.

-- ---------------------------------------------------------------------------
-- 1. coverage_override (defined here because the view reads it; T4.2 wires it)
-- ---------------------------------------------------------------------------
create table if not exists public.coverage_override (
  id uuid primary key default gen_random_uuid(),
  requirement_line_id uuid not null
    references public.requirement_line (id) on delete cascade,
  gap_qty numeric(14, 3) not null check (gap_qty > 0),
  reason text not null,
  risk text,
  mitigation text,
  approval_id uuid references public.approval (id) on delete set null,
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'rejected', 'resolved')),
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coverage_override_reason_chk check (length(btrim(reason)) >= 3)
);

create index if not exists coverage_override_line_idx
  on public.coverage_override (requirement_line_id);
create index if not exists coverage_override_status_idx
  on public.coverage_override (status);

alter table public.coverage_override enable row level security;
drop policy if exists coverage_override_select on public.coverage_override;
create policy coverage_override_select on public.coverage_override
  for select to authenticated using (true);
drop policy if exists coverage_override_write on public.coverage_override;
create policy coverage_override_write on public.coverage_override
  for all to authenticated
  using (public.has_any_role(array['owner','sales','operations','admin']::public.app_role[]))
  with check (public.has_any_role(array['owner','sales','operations','admin']::public.app_role[]));

-- ---------------------------------------------------------------------------
-- 2. Coverage view (TECH-STACK Â§9.1, adapted to the Phase 2/3 schema)
--    qty_quoted falls back to qty_required until quotations exist (T5.1 will
--    replace this view and add the quotation branch).
-- ---------------------------------------------------------------------------
create or replace view public.v_requirement_line_coverage
with (security_invoker = true) as
with ind as (
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
  rl.quantity_required                    as qty_quoted,
  coalesce(ind.qty_indicated, 0)          as qty_indicated,
  coalesce(com.qty_committed, 0)          as qty_committed,
  greatest(0, rl.quantity_required - coalesce(com.qty_committed, 0)) as qty_uncovered,
  exists (
    select 1 from public.coverage_override co
    where co.requirement_line_id = rl.id and co.status = 'approved'
  )                                       as has_approved_override
from public.requirement_line rl
left join ind on ind.requirement_line_id = rl.id
left join com on com.requirement_line_id = rl.id;

grant select on public.v_requirement_line_coverage to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Audit, updated_at, row_version and actor stamping for coverage_override
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
begin
  execute 'drop trigger if exists coverage_override_audit on public.coverage_override';
  execute 'create trigger coverage_override_audit after insert or update or delete on public.coverage_override for each row execute function public.audit_row_change()';
  execute 'drop trigger if exists coverage_override_updated_at on public.coverage_override';
  execute 'create trigger coverage_override_updated_at before update on public.coverage_override for each row execute function public.set_updated_at()';
  execute 'drop trigger if exists coverage_override_row_version on public.coverage_override';
  execute 'create trigger coverage_override_row_version before update on public.coverage_override for each row execute function public.bump_row_version()';
  execute 'drop trigger if exists coverage_override_stamp_actor on public.coverage_override';
  execute 'create trigger coverage_override_stamp_actor before insert or update on public.coverage_override for each row execute function public.stamp_actor()';
end
$$;

grant select, insert, update on public.coverage_override to authenticated;

-- >>> supabase/migrations/0011_coverage_override.sql
-- Defence Contract CRM â€” Phase 4: Coverage override with owner approval (T4.2)
-- A controlled, audited exception for uncovered quantity (FR-QTY-05, BR-11).
-- Idempotent. Depends on 0010_coverage.sql and the approval framework (0003).

-- ---------------------------------------------------------------------------
-- 1. Request an override (creates the approval request)
-- ---------------------------------------------------------------------------
create or replace function public.request_coverage_override(
  p_requirement_line_id uuid,
  p_gap_qty numeric,
  p_reason text,
  p_risk text default null,
  p_mitigation text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_approval uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.has_any_role(
    array['owner', 'sales', 'operations', 'admin']::public.app_role[]
  ) then
    raise exception 'FORBIDDEN: you may not request a coverage override';
  end if;
  if p_gap_qty is null or p_gap_qty <= 0 then
    raise exception 'The uncovered quantity must be greater than zero';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'A reason of at least 3 characters is required';
  end if;

  insert into public.coverage_override
    (requirement_line_id, gap_qty, reason, risk, mitigation, status)
  values
    (p_requirement_line_id, p_gap_qty, p_reason, p_risk, p_mitigation, 'requested')
  returning id into v_id;

  v_approval := public.request_approval('coverage_override', v_id, p_reason);

  update public.coverage_override
     set approval_id = v_approval, updated_at = now()
   where id = v_id;

  return v_id;
end;
$$;

grant execute on function public.request_coverage_override(uuid, numeric, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. An approved override is resolved automatically once commitments close it
-- ---------------------------------------------------------------------------
create or replace function public.resolve_coverage_overrides()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_required numeric;
  v_committed numeric;
begin
  select quantity_required into v_required
  from public.requirement_line
  where id = new.requirement_line_id;

  if v_required is null then
    return new;
  end if;

  v_committed := public.committed_qty(new.requirement_line_id, current_date);

  if v_committed >= v_required then
    update public.coverage_override
       set status = 'resolved', updated_at = now()
     where requirement_line_id = new.requirement_line_id
       and status = 'approved';
  end if;

  return new;
end;
$$;

drop trigger if exists quantity_commitment_resolve_overrides on public.quantity_commitment;
create trigger quantity_commitment_resolve_overrides
  after insert or update on public.quantity_commitment
  for each row execute function public.resolve_coverage_overrides();

-- >>> supabase/migrations/0012_tile_d08.sql
-- Defence Contract CRM â€” Phase 4: Coverage tile D-08 (T4.3 DB)
-- "Requirements with uncovered quantity" lines. The tile count and its
-- drill-down list share the same predicate (FR-DASH-01).
-- Idempotent. Depends on 0010_coverage.sql.

create or replace view public.v_tile_d08
with (security_invoker = true) as
select
  c.requirement_id      as requirement_id,
  c.requirement_line_id as requirement_line_id,
  c.line_no             as line_no,
  c.description         as description,
  c.uom                 as uom,
  c.qty_required        as qty_required,
  c.qty_indicated       as qty_indicated,
  c.qty_committed       as qty_committed,
  c.qty_uncovered       as qty_uncovered
from public.v_requirement_line_coverage c
where c.qty_uncovered > 0
  and not c.has_approved_override;

grant select on public.v_tile_d08 to authenticated;

-- ---------------------------------------------------------------------------
-- v_dashboard_kpis â€” now includes D-08 alongside D-01â€¦D-03
-- ---------------------------------------------------------------------------
create or replace view public.v_dashboard_kpis
with (security_invoker = true) as
select
  'D-01'::text      as tile_code,
  count(*)::bigint  as count_value,
  0::numeric        as amount_value,
  '{}'::jsonb       as qty_by_uom,
  0::bigint         as excluded_missing_count,
  now()             as as_of
from public.v_tile_d01
union all
select
  'D-02'::text,
  count(*)::bigint,
  0::numeric,
  '{}'::jsonb,
  0::bigint,
  now()
from public.v_tile_d02
union all
select
  'D-03'::text,
  count(*)::bigint,
  0::numeric,
  '{}'::jsonb,
  0::bigint,
  now()
from public.v_tile_d03
union all
select
  'D-08'::text,
  (select count(*) from public.v_tile_d08)::bigint,
  0::numeric,
  coalesce(
    (
      select jsonb_object_agg(x.uom, x.total)
      from (
        select uom, sum(qty_uncovered) as total
        from public.v_tile_d08
        group by uom
      ) x
    ),
    '{}'::jsonb
  ),
  0::bigint,
  now();

grant select on public.v_dashboard_kpis to authenticated;

