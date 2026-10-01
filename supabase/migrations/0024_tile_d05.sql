-- Defence Contract CRM — Phase 7: Orders-pending tile D-05 (T7.6)
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
