-- Defence Contract CRM — Phase 4: Coverage tile D-08 (T4.3 DB)
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
-- v_dashboard_kpis — now includes D-08 alongside D-01…D-03
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
