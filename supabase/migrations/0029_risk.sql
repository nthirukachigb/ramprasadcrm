-- Defence Contract CRM — Phase 8: Delivery risk, extensions, jobs and tiles (T8.6)
-- Risk is flagged before the due date; extension letters need Owner approval
-- before they can be marked Sent (FR-RISK-01/02). Adds jobs and tiles
-- D-06, D-09, D-10, D-11, D-12, D-13.
-- Idempotent. Depends on 0028_delivery.sql and 0019_jobs.sql.

insert into public.app_setting (key, value_num, description)
values ('delivery_risk_days', 15, 'Days before a committed date to flag delivery risk (Assumption).')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 1. v_delivery_risk
-- ---------------------------------------------------------------------------
create or replace view public.v_delivery_risk
with (security_invoker = true) as
select
  ds.po_line_id                       as po_line_id,
  pl.customer_po_id                   as customer_po_id,
  po.internal_ref                     as po_ref,
  ds.id                               as schedule_id,
  ds.sequence                         as sequence,
  ds.due_date                         as committed_date,
  ds.original_committed_date          as original_committed_date,
  ds.forecast_date                    as forecast_date,
  b.qty_outstanding                   as qty_outstanding,
  case
    when ds.due_date is null then 'unknown'
    when ds.due_date < current_date and b.qty_outstanding > 0 then 'late'
    when ds.forecast_date is null then 'unknown'
    when ds.forecast_date > ds.due_date then 'at_risk'
    when ds.due_date <= current_date + coalesce(public.setting_num('delivery_risk_days', 15), 15)::integer
         and b.qty_outstanding > 0 then 'at_risk'
    else 'on_track'
  end                                 as risk_status
from public.po_delivery_schedule ds
join public.po_line pl on pl.id = ds.po_line_id
join public.customer_po po on po.id = pl.customer_po_id
join public.v_po_line_balance b on b.po_line_id = ds.po_line_id;

grant select on public.v_delivery_risk to authenticated;

-- ---------------------------------------------------------------------------
-- 2. extension_request
-- ---------------------------------------------------------------------------
create table if not exists public.extension_request (
  id uuid primary key default gen_random_uuid(),
  customer_po_id uuid not null references public.customer_po (id) on delete cascade,
  po_line_id uuid references public.po_line (id) on delete cascade,
  requested_date date not null,
  reason text,
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'sent', 'granted', 'refused')),
  approval_id uuid references public.approval (id) on delete set null,
  letter_text text,
  sent_at timestamptz,
  response text,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists extension_request_po_idx on public.extension_request (customer_po_id);

insert into public.ref_status_transition (entity, from_status, to_status, requires_approval)
values
  ('extension_request', 'draft', 'pending_approval', false),
  ('extension_request', 'pending_approval', 'approved', false),
  ('extension_request', 'pending_approval', 'refused', false),
  ('extension_request', 'approved', 'sent', false),
  ('extension_request', 'sent', 'granted', false),
  ('extension_request', 'sent', 'refused', false)
on conflict (entity, from_status, to_status) do nothing;

create or replace function public.transition_extension_request(
  p_id uuid,
  p_to_status text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.extension_request;
  v_allowed boolean;
  v_approval uuid;
  v_decision text;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.has_any_role(
    array['owner', 'sales', 'operations', 'admin']::public.app_role[]
  ) then
    raise exception 'FORBIDDEN: you may not change an extension request';
  end if;

  select * into v_req from public.extension_request where id = p_id for update;
  if not found then
    raise exception 'Extension request not found';
  end if;

  select true into v_allowed from public.ref_status_transition t
  where t.entity = 'extension_request'
    and t.from_status = v_req.status and t.to_status = p_to_status;
  if v_allowed is null then
    raise exception 'BR-30: invalid extension transition from % to %', v_req.status, p_to_status;
  end if;

  if p_to_status = 'pending_approval' and v_req.approval_id is null then
    v_approval := public.request_approval(
      'extension_request', p_id, coalesce(v_req.reason, 'Extension request'));
  end if;

  -- A letter cannot be marked Sent without an approval (FR-RISK-02).
  if p_to_status = 'sent' then
    if v_req.approval_id is null then
      raise exception 'FR-RISK-02: an approval is required before the letter can be sent';
    end if;
    select decision into v_decision from public.approval where id = v_req.approval_id;
    if v_decision <> 'approved' then
      raise exception 'FR-RISK-02: the extension must be approved before it can be sent';
    end if;
  end if;

  update public.extension_request
     set status = p_to_status,
         approval_id = coalesce(v_approval, approval_id),
         sent_at = case when p_to_status = 'sent' then now() else sent_at end,
         updated_at = now()
   where id = p_id;

  -- A revised date applies only when granted.
  if p_to_status = 'granted' and v_req.po_line_id is not null then
    update public.po_delivery_schedule
       set due_date = v_req.requested_date, updated_at = now()
     where po_line_id = v_req.po_line_id
       and id = (
         select id from public.po_delivery_schedule
         where po_line_id = v_req.po_line_id
         order by sequence limit 1
       );
  end if;

  insert into public.status_history
    (entity_type, entity_id, from_status, to_status, actor, reason)
  values ('extension_request', p_id, v_req.status, p_to_status, auth.uid(), p_reason);
end;
$$;

grant execute on function public.transition_extension_request(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Tiles D-06, D-09, D-10, D-11, D-12, D-13
-- ---------------------------------------------------------------------------
create or replace view public.v_tile_d06
with (security_invoker = true) as
select * from public.v_delivery_risk
where risk_status in ('at_risk', 'late');
grant select on public.v_tile_d06 to authenticated;

create or replace view public.v_tile_d09
with (security_invoker = true) as
select
  pl.id as po_line_id,
  pl.customer_po_id as customer_po_id,
  pl.qty_ordered_effective as qty_ordered
from public.po_line pl
where exists (
    select 1 from public.fulfilment_milestone m
    where m.customer_po_id = pl.customer_po_id
      and (m.po_line_id = pl.id or m.po_line_id is null)
      and m.expected_date is not null and m.expected_date < current_date
      and m.status not in ('done', 'cancelled')
  )
  or exists (
    select 1 from public.po_delivery_schedule ds
    where ds.po_line_id = pl.id
      and ds.forecast_date is not null and ds.due_date is not null
      and ds.forecast_date > ds.due_date
  );
grant select on public.v_tile_d09 to authenticated;

create or replace view public.v_tile_d10
with (security_invoker = true) as
select p.id as pdi_id, p.customer_po_id, p.status, p.called_date
from public.pdi p
where p.status in ('called', 'in_progress');
grant select on public.v_tile_d10 to authenticated;

create or replace view public.v_tile_d11
with (security_invoker = true) as
select l.id as pdi_line_id, l.pdi_id, l.po_line_id, l.qty_held, l.qty_rejected
from public.pdi_line l
where l.qty_held > 0 or l.qty_rejected > 0;
grant select on public.v_tile_d11 to authenticated;

create or replace view public.v_tile_d12
with (security_invoker = true) as
select b.po_line_id, b.customer_po_id, b.qty_ordered, b.qty_accepted, b.qty_outstanding
from public.v_po_line_balance b
where b.qty_accepted > 0 and b.qty_accepted < b.qty_ordered;
grant select on public.v_tile_d12 to authenticated;

create or replace view public.v_tile_d13
with (security_invoker = true) as
select b.po_line_id, b.customer_po_id, pl.uom, b.qty_ordered, b.qty_accepted, b.qty_outstanding
from public.v_po_line_balance b
join public.po_line pl on pl.id = b.po_line_id
where b.qty_outstanding > 0;
grant select on public.v_tile_d13 to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Jobs: extend run_job with the fulfilment jobs
-- ---------------------------------------------------------------------------
insert into public.task_rule (rule_id, name, description, enabled)
values
  ('delivery_risk', 'Delivery at risk', 'A PO line schedule is at risk or late.', true),
  ('milestone_overdue', 'Milestone overdue', 'A fulfilment milestone is past its expected date.', true),
  ('pdi_blocked', 'PDI blocked', 'A PDI line has held or rejected quantity.', true),
  ('acceptance_pending', 'Acceptance pending', 'A delivered quantity is awaiting acceptance.', true)
on conflict (rule_id) do nothing;

create or replace function public.run_job(p_job text, p_triggered_by text default 'manual')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule text;
  v_enabled boolean;
  v_run uuid;
  v_count integer := 0;
  v_days integer;
begin
  v_rule := case p_job
    when 'quotation_deadlines' then 'quotation_deadline'
    when 'customer_no_response' then 'customer_no_response'
    when 'oem_response_followup' then 'oem_response_followup'
    when 'quotation_validity' then 'quotation_validity'
    when 'commitment_expiry' then 'commitment_expiry'
    when 'delivery_risk_refresh' then 'delivery_risk'
    when 'milestone_overdue' then 'milestone_overdue'
    when 'pdi_pending_blocked' then 'pdi_blocked'
    when 'acceptance_pending' then 'acceptance_pending'
    else null
  end;
  if v_rule is null then
    raise exception 'Unknown job: %', p_job;
  end if;

  select enabled into v_enabled from public.task_rule where rule_id = v_rule;
  if v_enabled is not true then
    insert into public.job_run (job_name, status, triggered_by, finished_at)
    values (p_job, 'skipped', p_triggered_by, now());
    return 0;
  end if;

  insert into public.job_run (job_name, status, triggered_by)
  values (p_job, 'running', p_triggered_by)
  returning id into v_run;

  begin
    if p_job = 'quotation_deadlines' then
      v_days := coalesce(public.setting_num('quotation_deadline_days', 3), 3)::integer;
      insert into public.task (rule_id, source_entity_type, source_entity_id, title, owner_user_id, due_date, priority)
      select 'quotation_deadline', 'requirement', r.id, 'Prepare quotation for ' || r.internal_ref,
             r.assigned_user_id, public.app_now()::date, 'high'
      from public.requirement r
      where r.submission_deadline is not null
        and r.status not in ('submitted','won','partially_won','lost','not_pursued','cancelled','closed')
        and r.submission_deadline between public.app_now() and public.app_now() + make_interval(days => v_days)
        and not exists (select 1 from public.task t where t.rule_id='quotation_deadline' and t.source_entity_id=r.id and t.status='open');
      get diagnostics v_count = row_count;

    elsif p_job = 'customer_no_response' then
      v_days := coalesce(public.setting_num('no_response_days', 7), 7)::integer;
      insert into public.task (rule_id, source_entity_type, source_entity_id, title, owner_user_id, due_date, priority)
      select 'customer_no_response', 'quotation', q.id, 'Chase customer response for ' || coalesce(q.internal_quote_no, q.id::text),
             r.assigned_user_id, public.app_now()::date, 'high'
      from public.quotation q
      join public.requirement r on r.id = q.requirement_id
      join public.quotation_version qv on qv.id = q.current_version_id and qv.status = 'submitted'
      join public.customer_response cr on cr.quotation_id = q.id and cr.status = 'submitted'
      where qv.submitted_at is not null
        and qv.submitted_at <= public.app_now() - make_interval(days => v_days)
        and not exists (select 1 from public.task t where t.rule_id='customer_no_response' and t.source_entity_id=q.id and t.status='open');
      get diagnostics v_count = row_count;

    elsif p_job = 'oem_response_followup' then
      insert into public.task (rule_id, source_entity_type, source_entity_id, title, owner_user_id, due_date, priority)
      select 'oem_response_followup', 'sourcing_request', sr.id, 'Chase OEM response for ' || coalesce(p.name, sr.partner_id::text),
             r.assigned_user_id, public.app_now()::date, 'medium'
      from public.sourcing_request sr
      join public.requirement r on r.id = sr.requirement_id
      join public.partner p on p.id = sr.partner_id
      where sr.status in ('sent', 'overdue')
        and sr.response_due_date is not null and sr.response_due_date < public.app_now()::date
        and not exists (select 1 from public.task t where t.rule_id='oem_response_followup' and t.source_entity_id=sr.id and t.status='open');
      get diagnostics v_count = row_count;

    elsif p_job = 'quotation_validity' then
      v_days := coalesce(public.setting_num('quotation_validity_days', 14), 14)::integer;
      insert into public.task (rule_id, source_entity_type, source_entity_id, title, owner_user_id, due_date, priority)
      select 'quotation_validity', 'quotation', q.id, 'Quotation validity expiring for ' || coalesce(q.internal_quote_no, q.id::text),
             r.assigned_user_id, qv.valid_until, 'medium'
      from public.quotation q
      join public.requirement r on r.id = q.requirement_id
      join public.quotation_version qv on qv.id = q.current_version_id and qv.status = 'approved'
      where qv.valid_until is not null
        and qv.valid_until between public.app_now()::date and public.app_now()::date + v_days
        and not exists (select 1 from public.task t where t.rule_id='quotation_validity' and t.source_entity_id=q.id and t.status='open');
      get diagnostics v_count = row_count;

    elsif p_job = 'commitment_expiry' then
      v_days := coalesce(public.setting_num('commitment_expiry_days', 7), 7)::integer;
      insert into public.task (rule_id, source_entity_type, source_entity_id, title, owner_user_id, due_date, priority)
      select 'commitment_expiry', 'quantity_commitment', qc.id, 'Commitment expiring', null, qc.valid_until, 'medium'
      from public.quantity_commitment qc
      where qc.status = 'active' and qc.valid_until is not null
        and qc.valid_until between public.app_now()::date and public.app_now()::date + v_days
        and not exists (select 1 from public.task t where t.rule_id='commitment_expiry' and t.source_entity_id=qc.id and t.status='open');
      get diagnostics v_count = row_count;

    elsif p_job = 'delivery_risk_refresh' then
      insert into public.task (rule_id, source_entity_type, source_entity_id, title, owner_user_id, due_date, priority)
      select 'delivery_risk', 'po_line', r.po_line_id,
             'Delivery at risk on ' || coalesce(r.po_ref, r.po_line_id::text),
             null, r.committed_date, 'high'
      from public.v_delivery_risk r
      where r.risk_status in ('at_risk', 'late')
        and not exists (select 1 from public.task t where t.rule_id='delivery_risk' and t.source_entity_id=r.po_line_id and t.status='open');
      get diagnostics v_count = row_count;

    elsif p_job = 'milestone_overdue' then
      update public.fulfilment_milestone
         set status = 'overdue', updated_at = now()
       where expected_date is not null and expected_date < public.app_now()::date
         and status in ('pending', 'in_progress');
      insert into public.task (rule_id, source_entity_type, source_entity_id, title, owner_user_id, due_date, priority)
      select 'milestone_overdue', 'fulfilment_milestone', m.id, 'Milestone overdue: ' || m.name,
             m.owner_user_id, m.expected_date, 'medium'
      from public.fulfilment_milestone m
      where m.status = 'overdue'
        and not exists (select 1 from public.task t where t.rule_id='milestone_overdue' and t.source_entity_id=m.id and t.status='open');
      get diagnostics v_count = row_count;

    elsif p_job = 'pdi_pending_blocked' then
      insert into public.task (rule_id, source_entity_type, source_entity_id, title, owner_user_id, due_date, priority)
      select 'pdi_blocked', 'pdi_line', l.id, 'PDI held/rejected quantity', null, public.app_now()::date, 'high'
      from public.pdi_line l
      where (l.qty_held > 0 or l.qty_rejected > 0)
        and not exists (select 1 from public.task t where t.rule_id='pdi_blocked' and t.source_entity_id=l.id and t.status='open');
      get diagnostics v_count = row_count;

    elsif p_job = 'acceptance_pending' then
      insert into public.task (rule_id, source_entity_type, source_entity_id, title, owner_user_id, due_date, priority)
      select 'acceptance_pending', 'delivery', d.id, 'Acceptance pending for ' || coalesce(d.internal_ref, d.id::text),
             null, d.delivery_date, 'medium'
      from public.delivery d
      where d.status = 'delivered'
        and not exists (select 1 from public.acceptance a where a.delivery_id = d.id and a.status in ('accepted','partially_accepted'))
        and not exists (select 1 from public.task t where t.rule_id='acceptance_pending' and t.source_entity_id=d.id and t.status='open');
      get diagnostics v_count = row_count;
    end if;

    update public.job_run set status='success', created_count=v_count, finished_at=now() where id = v_run;
  exception when others then
    update public.job_run set status='failed', error=sqlerrm, finished_at=now() where id = v_run;
    raise;
  end;

  return v_count;
end;
$$;

grant execute on function public.run_job(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Extend v_dashboard_kpis
-- ---------------------------------------------------------------------------
create or replace view public.v_dashboard_kpis
with (security_invoker = true) as
select 'D-01'::text as tile_code, count(*)::bigint as count_value, 0::numeric as amount_value,
       '{}'::jsonb as qty_by_uom, 0::bigint as excluded_missing_count, now() as as_of
from public.v_tile_d01
union all select 'D-02', count(*)::bigint, 0::numeric, '{}'::jsonb, 0::bigint, now() from public.v_tile_d02
union all select 'D-03', count(*)::bigint, 0::numeric, '{}'::jsonb, 0::bigint, now() from public.v_tile_d03
union all select 'D-05', count(*)::bigint, coalesce(sum(amount),0)::numeric, '{}'::jsonb, 0::bigint, now() from public.v_tile_d05
union all
select 'D-06', (select count(distinct customer_po_id) from public.v_tile_d06)::bigint, 0::numeric, '{}'::jsonb, 0::bigint, now()
union all
select 'D-08',
  (select count(*) from public.v_tile_d08)::bigint, 0::numeric,
  coalesce((select jsonb_object_agg(x.uom, x.total) from (select uom, sum(qty_uncovered) as total from public.v_tile_d08 group by uom) x), '{}'::jsonb),
  0::bigint, now()
union all select 'D-09', count(*)::bigint, 0::numeric, '{}'::jsonb, 0::bigint, now() from public.v_tile_d09
union all select 'D-10', count(*)::bigint, 0::numeric, '{}'::jsonb, 0::bigint, now() from public.v_tile_d10
union all select 'D-11', count(*)::bigint, 0::numeric, '{}'::jsonb, 0::bigint, now() from public.v_tile_d11
union all select 'D-12', count(*)::bigint, 0::numeric, '{}'::jsonb, 0::bigint, now() from public.v_tile_d12
union all
select 'D-13',
  count(*)::bigint, 0::numeric,
  coalesce((select jsonb_object_agg(x.uom, x.total) from (select uom, sum(qty_outstanding) as total from public.v_tile_d13 group by uom) x), '{}'::jsonb),
  0::bigint, now()
from public.v_tile_d13;

grant select on public.v_dashboard_kpis to authenticated;

-- ---------------------------------------------------------------------------
-- 6. RLS, audit and grants for extension_request
-- ---------------------------------------------------------------------------
do $$
begin
  execute 'drop trigger if exists extension_request_audit on public.extension_request';
  execute 'create trigger extension_request_audit after insert or update or delete on public.extension_request for each row execute function public.audit_row_change()';
  execute 'drop trigger if exists extension_request_updated_at on public.extension_request';
  execute 'create trigger extension_request_updated_at before update on public.extension_request for each row execute function public.set_updated_at()';
  execute 'drop trigger if exists extension_request_row_version on public.extension_request';
  execute 'create trigger extension_request_row_version before update on public.extension_request for each row execute function public.bump_row_version()';
end
$$;

alter table public.extension_request enable row level security;
drop policy if exists extension_request_select on public.extension_request;
create policy extension_request_select on public.extension_request
  for select to authenticated using (true);
drop policy if exists extension_request_write on public.extension_request;
create policy extension_request_write on public.extension_request
  for all to authenticated
  using (public.has_any_role(array['owner','sales','operations','admin']::public.app_role[]))
  with check (public.has_any_role(array['owner','sales','operations','admin']::public.app_role[]));

grant select, insert, update on public.extension_request to authenticated;
