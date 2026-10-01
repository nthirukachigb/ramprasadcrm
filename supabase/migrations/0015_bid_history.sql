-- Defence Contract CRM — Phase 5: Bid history (T5.5 DB)
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
-- 2. v_bid_history (no margin) — TECH-STACK §9.9
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
-- 3. comparable_history(line_id) — exact / cross-reference / possible
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
