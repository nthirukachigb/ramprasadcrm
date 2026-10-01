-- Defence Contract CRM — Phase 10: expiry tile D-18 and renewal visibility
-- Adds the expiring approval tile and keeps the dashboard KPI count in sync.

create or replace view public.v_tile_d18
with (security_invoker = true) as
select
  ca.id as approval_id,
  ca.certificate_no,
  ca.authority,
  ca.valid_until,
  greatest(ca.valid_until, coalesce(max(ce.extended_until), ca.valid_until)) as effective_valid_until,
  current_date + interval '90 days' as window_end,
  ca.apply_for_renewal_by
from public.compliance_approval ca
left join public.certificate_extension ce on ce.approval_id = ca.id
group by ca.id, ca.certificate_no, ca.authority, ca.valid_until, ca.apply_for_renewal_by
having greatest(ca.valid_until, coalesce(max(ce.extended_until), ca.valid_until)) <= current_date + interval '90 days';

grant select on public.v_tile_d18 to authenticated;

create or replace view public.v_dashboard_kpis
with (security_invoker = true) as
select 'D-01'::text as tile_code, count(*)::bigint as count_value, 0::numeric as amount_value,
       '{}'::jsonb as qty_by_uom, 0::bigint as excluded_missing_count, now() as as_of
from public.v_tile_d01
union all
select 'D-02'::text as tile_code, count(*)::bigint as count_value, 0::numeric as amount_value,
       '{}'::jsonb as qty_by_uom, 0::bigint as excluded_missing_count, now() as as_of
from public.v_tile_d02
union all
select 'D-03'::text as tile_code, count(*)::bigint as count_value, 0::numeric as amount_value,
       '{}'::jsonb as qty_by_uom, 0::bigint as excluded_missing_count, now() as as_of
from public.v_tile_d03
union all
select 'D-05'::text as tile_code, count(*)::bigint as count_value, 0::numeric as amount_value,
       '{}'::jsonb as qty_by_uom, 0::bigint as excluded_missing_count, now() as as_of
from public.v_tile_d05
union all
select 'D-08'::text as tile_code, count(*)::bigint as count_value, 0::numeric as amount_value,
       '{}'::jsonb as qty_by_uom, 0::bigint as excluded_missing_count, now() as as_of
from public.v_tile_d08
union all
select 'D-10'::text as tile_code, count(*)::bigint as count_value, 0::numeric as amount_value,
       '{}'::jsonb as qty_by_uom, 0::bigint as excluded_missing_count, now() as as_of
from public.v_tile_d10
union all
select 'D-11'::text as tile_code, count(*)::bigint as count_value, 0::numeric as amount_value,
       '{}'::jsonb as qty_by_uom, 0::bigint as excluded_missing_count, now() as as_of
from public.v_tile_d11
union all
select 'D-12'::text as tile_code, count(*)::bigint as count_value, 0::numeric as amount_value,
       '{}'::jsonb as qty_by_uom, 0::bigint as excluded_missing_count, now() as as_of
from public.v_tile_d12
union all
select 'D-13'::text as tile_code, count(*)::bigint as count_value, 0::numeric as amount_value,
       '{}'::jsonb as qty_by_uom, 0::bigint as excluded_missing_count, now() as as_of
from public.v_tile_d13
union all
select 'D-18'::text as tile_code, count(*)::bigint as count_value, 0::numeric as amount_value,
       '{}'::jsonb as qty_by_uom, 0::bigint as excluded_missing_count, now() as as_of
from public.v_tile_d18;

grant select on public.v_dashboard_kpis to authenticated;
