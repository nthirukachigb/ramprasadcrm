-- Defence Contract CRM — Phase 4: Quantity coverage (T4.1)
-- The single source of truth for per-line coverage, calculated in the database
-- and read by every screen, tile and export (P10, FR-QTY-01…03, BR-10/BR-11).
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
-- 2. Coverage view (TECH-STACK §9.1, adapted to the Phase 2/3 schema)
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
