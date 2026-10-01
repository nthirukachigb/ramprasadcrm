-- Defence Contract CRM — Phase 12: complete dashboard KPI contract (T12.1)
-- One drill-down view per tile and one canonical KPI row per D-01..D-20.
-- Idempotent. Depends on migrations through 0034.

-- ---------------------------------------------------------------------------
-- Tile drill-down views
-- ---------------------------------------------------------------------------

-- D-02 becomes precise once quotation versions exist: preparation with no
-- approved/submitted version for the requirement.
create or replace view public.v_tile_d02
with (security_invoker = true) as
select r.id as requirement_id, r.internal_ref, r.customer_id,
       c.name as customer_name, r.status, r.assigned_user_id,
       r.submission_deadline, r.created_at
from public.requirement r
join public.customer c on c.id = r.customer_id
where r.status = 'in_preparation'
  and not exists (
    select 1
    from public.quotation q
    join public.quotation_version qv on qv.id = q.current_version_id
    where q.requirement_id = r.id
      and qv.status in ('approved', 'submitted')
  );

grant select on public.v_tile_d02 to authenticated;

-- D-04: the current customer response is the quotation's response status.
create or replace view public.v_tile_d04
with (security_invoker = true) as
select q.id as quotation_id, q.internal_quote_no, q.requirement_id,
       r.internal_ref, r.customer_id, c.name as customer_name,
       cr.status as response_status, cr.response_date, qv.id as version_id,
       qv.submitted_at
from public.quotation q
join public.requirement r on r.id = q.requirement_id
join public.customer c on c.id = r.customer_id
join public.quotation_version qv on qv.id = q.current_version_id
join lateral (
  select response.*
  from public.customer_response response
  where response.quotation_id = q.id
  order by response.response_date desc, response.created_at desc
  limit 1
) cr on true
where cr.status in (
  'submitted', 'clarification_requested', 'technical_clarification',
  'commercial_negotiation', 'awaiting_decision'
);

grant select on public.v_tile_d04 to authenticated;

-- D-05: only open customer PO states count. The view remains one row per PO
-- so its drill-down count matches the KPI count.
create or replace view public.v_tile_d05
with (security_invoker = true) as
select po.id as customer_po_id, po.internal_ref, po.customer_id,
       c.name as customer_name, po.status, po.po_date,
       coalesce(sum(pl.qty_ordered_effective * pl.unit_rate), 0) as amount,
       po.created_at
from public.customer_po po
join public.customer c on c.id = po.customer_id
left join public.po_line pl on pl.customer_po_id = po.id
where po.status in ('received', 'under_review', 'acknowledged', 'amended')
group by po.id, po.internal_ref, po.customer_id, c.name, po.status,
         po.po_date, po.created_at;

grant select on public.v_tile_d05 to authenticated;

-- D-07: pending sourcing requests, with an explicit overdue flag.
create or replace view public.v_tile_d07
with (security_invoker = true) as
select sr.id as sourcing_request_id, sr.requirement_id, sr.partner_id,
       p.name as partner_name, sr.status, sr.request_date,
       sr.response_due_date,
       sr.response_due_date is not null and sr.response_due_date < current_date
         as is_overdue
from public.sourcing_request sr
join public.partner p on p.id = sr.partner_id
where sr.status in ('sent', 'overdue');

grant select on public.v_tile_d07 to authenticated;

-- D-08: only unresolved gaps are tile rows. Keep both the requirement and PO
-- context available for drill-down consumers.
create or replace view public.v_tile_d08
with (security_invoker = true) as
select c.requirement_id, c.requirement_line_id, c.line_no, c.description,
       c.uom, c.qty_required, c.qty_indicated, c.qty_committed,
       c.qty_uncovered, c.qty_quoted, c.has_approved_override
from public.v_requirement_line_coverage c
where c.qty_uncovered > 0 and not c.has_approved_override;

grant select on public.v_tile_d08 to authenticated;

-- D-09: overdue milestones or a forecast after the committed date.
create or replace view public.v_tile_d09
with (security_invoker = true) as
select pl.id as po_line_id, pl.customer_po_id,
  pl.qty_ordered_effective as qty_ordered,
       case when exists (
         select 1 from public.fulfilment_milestone m
         where m.customer_po_id = pl.customer_po_id
           and (m.po_line_id = pl.id or m.po_line_id is null)
           and m.expected_date < current_date
           and m.status not in ('done', 'cancelled')
       ) then 'milestone_overdue' else 'forecast_after_committed' end as issue_type
from public.po_line pl
where exists (
  select 1 from public.fulfilment_milestone m
  where m.customer_po_id = pl.customer_po_id
    and (m.po_line_id = pl.id or m.po_line_id is null)
    and m.expected_date < current_date
    and m.status not in ('done', 'cancelled')
)
or exists (
  select 1 from public.po_delivery_schedule ds
  where ds.po_line_id = pl.id
    and ds.forecast_date is not null
    and ds.due_date is not null
    and ds.forecast_date > ds.due_date
);

grant select on public.v_tile_d09 to authenticated;

-- D-11: held or rejected quantities require follow-up. The current schema has
-- no separate disposition column, so every such row is treated as unresolved.
create or replace view public.v_tile_d11
with (security_invoker = true) as
select l.id as pdi_line_id, l.pdi_id, l.po_line_id,
       l.qty_held, l.qty_rejected
from public.pdi_line l
where l.qty_held > 0 or l.qty_rejected > 0;

grant select on public.v_tile_d11 to authenticated;

-- D-12 and D-13 remain canonical balance-based drill-downs.
create or replace view public.v_tile_d12
with (security_invoker = true) as
select b.po_line_id, b.customer_po_id, b.qty_ordered,
       b.qty_accepted, b.qty_outstanding
from public.v_po_line_balance b
where b.qty_accepted > 0 and b.qty_accepted < b.qty_ordered;

grant select on public.v_tile_d12 to authenticated;

create or replace view public.v_tile_d13
with (security_invoker = true) as
select b.po_line_id, b.customer_po_id, pl.uom,
       b.qty_ordered, b.qty_accepted, b.qty_outstanding
from public.v_po_line_balance b
join public.po_line pl on pl.id = b.po_line_id
where b.qty_outstanding > 0;

grant select on public.v_tile_d13 to authenticated;

-- D-14 and D-15 use the same balance source as finance screens.
create or replace view public.v_tile_d14
with (security_invoker = true) as
select vb.invoice_id, i.customer_po_id, i.invoice_number, i.due_date,
       vb.balance_amount as open_balance,
       i.due_date - current_date as days_until_due
from public.v_invoice_balance vb
join public.invoice i on i.id = vb.invoice_id
where vb.balance_amount > 0
  and i.due_date is not null
  and i.due_date >= current_date
  and i.due_date <= current_date + coalesce(
    public.setting_num('payment_due_days', 15), 15)::integer;

grant select on public.v_tile_d14 to authenticated;

create or replace view public.v_tile_d15
with (security_invoker = true) as
select vb.invoice_id, i.customer_po_id, i.invoice_number, i.due_date,
       vb.balance_amount as open_balance,
       current_date - i.due_date as days_past_due,
       case
         when current_date - i.due_date between 1 and 30 then '1-30'
         when current_date - i.due_date between 31 and 60 then '31-60'
         when current_date - i.due_date between 61 and 90 then '61-90'
         else '90+'
       end as ageing_bucket
from public.v_invoice_balance vb
join public.invoice i on i.id = vb.invoice_id
where vb.balance_amount > 0
  and i.due_date < current_date;

grant select on public.v_tile_d15 to authenticated;

-- D-16: recorded/proposed/approved deductions that still need resolution.
create or replace view public.v_tile_d16
with (security_invoker = true) as
select d.id as deduction_id, d.invoice_id, d.deduction_type,
       d.amount, d.status, d.created_at
from public.deduction d
where d.status in ('proposed', 'approved', 'disputed');

grant select on public.v_tile_d16 to authenticated;

-- D-17: keep eligible-not-invoiced and invoiced receivable rows visible.
create or replace view public.v_tile_d17
with (security_invoker = true) as
select r.eligibility_id, r.partner_id, r.partner_name, r.invoice_id,
       r.commission_invoice_id, r.commission_amount,
       case when r.commission_invoice_id is null then r.commission_amount
            else 0 end as eligible_not_invoiced,
       case when r.commission_invoice_id is not null
             and r.commission_invoice_status not in ('paid', 'cancelled')
            then r.commission_amount else 0 end as invoiced_receivable,
       r.status
from public.v_commission_receivable r
where r.status in ('proposed', 'approved', 'invoiced', 'exception');

grant select on public.v_tile_d17 to authenticated;

-- D-18 includes approvals and any documents that carry an expiry date. The
-- current document schema has no expiry column, so the document branch is
-- guarded by the approval view until that field is introduced.
create or replace view public.v_tile_d18
with (security_invoker = true) as
select v.approval_id, v.certificate_no, v.certificate_no as authority,
       v.effective_valid_until as valid_until, v.effective_valid_until,
       current_date + make_interval(days => coalesce(
         public.setting_num('certificate_expiry_days', 90), 90)::integer) as window_end,
       v.apply_for_renewal_by,
       case when v.effective_valid_until < current_date then 'expired'
            when v.effective_valid_until <= current_date + 30 then '0-30'
            when v.effective_valid_until <= current_date + 60 then '31-60'
            else '61-90' end as expiry_band
from public.v_certificate_effective_validity v
where v.effective_valid_until <= current_date + coalesce(
  public.setting_num('certificate_expiry_days', 90), 90)::integer
   or (v.apply_for_renewal_by is not null and v.apply_for_renewal_by < current_date);

grant select on public.v_tile_d18 to authenticated;

-- D-19 and D-20 use line outcomes as the authoritative decision records.
create or replace view public.v_tile_d19
with (security_invoker = true) as
select lo.id as line_outcome_id, lo.quotation_version_id,
       lo.requirement_line_id, lo.qty_won, ql.proposed_unit_price,
       lo.qty_won * coalesce(ql.proposed_unit_price, 0) as value,
       lo.created_at as decision_date
from public.line_outcome lo
join public.quotation_line ql
  on ql.quotation_version_id = lo.quotation_version_id
 and ql.requirement_line_id = lo.requirement_line_id
where lo.outcome in ('won', 'partially_won')
  and lo.created_at >= current_date - coalesce(
    public.setting_num('recent_outcome_days', 30), 30)::integer;

grant select on public.v_tile_d19 to authenticated;

create or replace view public.v_tile_d20
with (security_invoker = true) as
select lo.id as line_outcome_id, lo.quotation_version_id,
       lo.requirement_line_id, lo.outcome, lo.loss_reason_code,
       lo.qty_lost, lo.winning_price, lo.created_at as decision_date
from public.line_outcome lo
where lo.outcome in ('lost', 'cancelled', 'not_pursued')
  and lo.created_at >= current_date - coalesce(
    public.setting_num('recent_outcome_days', 30), 30)::integer;

grant select on public.v_tile_d20 to authenticated;

-- ---------------------------------------------------------------------------
-- Canonical KPI view: exactly one row for every D-01..D-20.
-- ---------------------------------------------------------------------------
create or replace view public.v_dashboard_kpis
with (security_invoker = true) as
select 'D-01'::text tile_code, count(*)::bigint count_value, 0::numeric amount_value, '{}'::jsonb qty_by_uom, 0::bigint excluded_missing_count, now() as_of from public.v_tile_d01
union all select 'D-02', count(*)::bigint, 0::numeric, '{}'::jsonb, 0::bigint, now() from public.v_tile_d02
union all select 'D-03', count(*)::bigint, 0::numeric, '{}'::jsonb, 0::bigint, now() from public.v_tile_d03
union all select 'D-04', count(*)::bigint, 0::numeric, '{}'::jsonb, 0::bigint, now() from public.v_tile_d04
union all select 'D-05', count(*)::bigint, coalesce(sum(amount), 0)::numeric, '{}'::jsonb, 0::bigint, now() from public.v_tile_d05
union all select 'D-06', count(distinct customer_po_id)::bigint, 0::numeric, '{}'::jsonb, 0::bigint, now() from public.v_tile_d06
union all select 'D-07', count(*)::bigint, 0::numeric, '{}'::jsonb, 0::bigint, now() from public.v_tile_d07
union all select 'D-08', count(*)::bigint, 0::numeric, coalesce(jsonb_object_agg(uom, total), '{}'::jsonb), 0::bigint, now() from (select uom, sum(qty_uncovered) total from public.v_tile_d08 group by uom) gaps
union all select 'D-09', count(*)::bigint, 0::numeric, '{}'::jsonb, 0::bigint, now() from public.v_tile_d09
union all select 'D-10', count(*)::bigint, 0::numeric, '{}'::jsonb, 0::bigint, now() from public.v_tile_d10
union all select 'D-11', count(*)::bigint, 0::numeric, '{}'::jsonb, 0::bigint, now() from public.v_tile_d11
union all select 'D-12', count(*)::bigint, 0::numeric, '{}'::jsonb, 0::bigint, now() from public.v_tile_d12
union all select 'D-13', count(*)::bigint, 0::numeric, coalesce(jsonb_object_agg(uom, total), '{}'::jsonb), 0::bigint, now() from (select uom, sum(qty_outstanding) total from public.v_tile_d13 group by uom) outstanding
union all select 'D-14', count(*)::bigint, coalesce(sum(open_balance), 0)::numeric, '{}'::jsonb, 0::bigint, now() from public.v_tile_d14
union all select 'D-15', count(*)::bigint, coalesce(sum(open_balance), 0)::numeric, '{}'::jsonb, 0::bigint, now() from public.v_tile_d15
union all select 'D-16', count(*)::bigint, coalesce(sum(amount), 0)::numeric, '{}'::jsonb, 0::bigint, now() from public.v_tile_d16
union all select 'D-17', count(*)::bigint, coalesce(sum(eligible_not_invoiced + invoiced_receivable), 0)::numeric, '{}'::jsonb, 0::bigint, now() from public.v_tile_d17
union all select 'D-18', count(*)::bigint, 0::numeric, '{}'::jsonb, 0::bigint, now() from public.v_tile_d18
union all select 'D-19', count(*)::bigint, coalesce(sum(value), 0)::numeric, '{}'::jsonb, 0::bigint, now() from public.v_tile_d19
union all select 'D-20', count(*)::bigint, 0::numeric, '{}'::jsonb, 0::bigint, now() from public.v_tile_d20;

grant select on public.v_dashboard_kpis to authenticated;

-- Dashboard query indexes used by the live KPI views.
create index if not exists requirement_dashboard_status_deadline_idx
  on public.requirement (status, submission_deadline);
create index if not exists quotation_version_dashboard_status_idx
  on public.quotation_version (status, quotation_id);
create index if not exists sourcing_request_dashboard_status_due_idx
  on public.sourcing_request (status, response_due_date);
create index if not exists invoice_dashboard_due_idx
  on public.invoice (due_date, status);
create index if not exists line_outcome_dashboard_created_idx
  on public.line_outcome (created_at, outcome);
