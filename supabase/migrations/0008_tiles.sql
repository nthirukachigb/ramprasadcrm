-- Defence Contract CRM — Phase 2: Early dashboard tiles (T2.9)
-- Tile D-01 (enquiries awaiting qualification), D-02 (quotations pending
-- preparation) and D-03 (approaching submission deadlines), with drill-down
-- views whose predicates are the same as the tile counts (FR-DASH-01).
-- Idempotent. Depends on 0003_requirements.sql.

insert into public.app_setting (key, value_num, description)
values ('deadline_alert_days', 7, 'Days before the submission deadline that a requirement appears on tile D-03.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Drill-down views (one row per qualifying requirement)
-- ---------------------------------------------------------------------------
create or replace view public.v_tile_d01
with (security_invoker = true) as
select
  r.id                      as requirement_id,
  r.internal_ref            as internal_ref,
  r.customer_id             as customer_id,
  c.name                    as customer_name,
  r.status                  as status,
  r.assigned_user_id        as assigned_user_id,
  r.submission_deadline     as submission_deadline,
  r.created_at              as created_at
from public.requirement r
join public.customer c on c.id = r.customer_id
where r.status in ('received', 'qualifying');

-- D-02: "In preparation and no approved version". Until quotations exist
-- (T5.1) every in-preparation requirement counts; the quotation branch is
-- added when the quotation tables land.
create or replace view public.v_tile_d02
with (security_invoker = true) as
select
  r.id                      as requirement_id,
  r.internal_ref            as internal_ref,
  r.customer_id             as customer_id,
  c.name                    as customer_name,
  r.status                  as status,
  r.assigned_user_id        as assigned_user_id,
  r.submission_deadline     as submission_deadline,
  r.created_at              as created_at
from public.requirement r
join public.customer c on c.id = r.customer_id
where r.status = 'in_preparation';

create or replace view public.v_tile_d03
with (security_invoker = true) as
select
  r.id                      as requirement_id,
  r.internal_ref            as internal_ref,
  r.customer_id             as customer_id,
  c.name                    as customer_name,
  r.status                  as status,
  r.assigned_user_id        as assigned_user_id,
  r.submission_deadline     as submission_deadline,
  r.created_at              as created_at
from public.requirement r
join public.customer c on c.id = r.customer_id
where r.status not in (
        'submitted', 'won', 'partially_won', 'lost',
        'not_pursued', 'cancelled', 'closed'
      )
  and r.submission_deadline is not null
  and r.submission_deadline >= now()
  and r.submission_deadline <=
      now() + make_interval(
        days => coalesce(public.setting_num('deadline_alert_days', 7), 7)::integer
      );

-- ---------------------------------------------------------------------------
-- v_dashboard_kpis — one row per available tile code
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
  'D-02'::text      as tile_code,
  count(*)::bigint  as count_value,
  0::numeric        as amount_value,
  '{}'::jsonb       as qty_by_uom,
  0::bigint         as excluded_missing_count,
  now()             as as_of
from public.v_tile_d02
union all
select
  'D-03'::text      as tile_code,
  count(*)::bigint  as count_value,
  0::numeric        as amount_value,
  '{}'::jsonb       as qty_by_uom,
  0::bigint         as excluded_missing_count,
  now()             as as_of
from public.v_tile_d03;

grant select on public.v_tile_d01 to authenticated;
grant select on public.v_tile_d02 to authenticated;
grant select on public.v_tile_d03 to authenticated;
grant select on public.v_dashboard_kpis to authenticated;
