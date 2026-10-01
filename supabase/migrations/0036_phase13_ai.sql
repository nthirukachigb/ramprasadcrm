-- Defence Contract CRM — Phase 13: AI query log + read-only tool catalogue
-- Idempotent. Depends on the Phase 12 dashboard views and the core requirement/PO tables.

create table if not exists public.ai_query_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  tool_name text not null,
  question_redacted text not null,
  request_params jsonb not null default '{}'::jsonb,
  result_count integer not null default 0,
  record_ids uuid[] not null default '{}',
  permission_blocked boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists ai_query_log_user_idx
  on public.ai_query_log (user_id, created_at desc);

alter table public.ai_query_log enable row level security;
drop policy if exists ai_query_log_select on public.ai_query_log;
create policy ai_query_log_select on public.ai_query_log
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.has_any_role(array['owner', 'admin']::public.app_role[])
  );
drop policy if exists ai_query_log_insert on public.ai_query_log;
create policy ai_query_log_insert on public.ai_query_log
  for insert to authenticated
  with check (user_id = auth.uid());

-- Read-only tool catalogue: these functions are limited to SELECT/EXECUTE and
-- execute under the user's session so they never write data.
create or replace function public.count_open_orders(
  p_status text[] default null,
  p_customer_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'count', count(*),
    'status', coalesce(p_status, array['received', 'under_review', 'acknowledged', 'amended']::text[]),
    'records', coalesce(jsonb_agg(jsonb_build_object('id', id, 'status', status)), '[]'::jsonb)
  )
  from (
    select cp.id, cp.status
    from public.customer_po cp
    where (
      p_status is null
      or cp.status::text = any (p_status)
    )
      and (p_customer_id is null or cp.customer_id = p_customer_id)
  ) q;
$$;

grant execute on function public.count_open_orders(text[], uuid) to authenticated;

grant select on public.ai_query_log to authenticated;

create or replace function public.list_wins(
  p_from date default null,
  p_to date default null,
  p_customer_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'count', count(*),
    'records', coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'customer_id', r.customer_id, 'status', r.status)), '[]'::jsonb)
  )
  from public.requirement r
  where r.status in ('won', 'partially_won')
    and (p_from is null or r.enquiry_date >= p_from)
    and (p_to is null or r.enquiry_date <= p_to)
    and (p_customer_id is null or r.customer_id = p_customer_id);
$$;

grant execute on function public.list_wins(date, date, uuid) to authenticated;

create or replace function public.list_losses(
  p_from date default null,
  p_to date default null,
  p_customer_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'count', count(*),
    'records', coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'customer_id', r.customer_id, 'status', r.status)), '[]'::jsonb)
  )
  from public.requirement r
  where r.status in ('lost', 'cancelled')
    and (p_from is null or r.enquiry_date >= p_from)
    and (p_to is null or r.enquiry_date <= p_to)
    and (p_customer_id is null or r.customer_id = p_customer_id);
$$;

grant execute on function public.list_losses(date, date, uuid) to authenticated;

create or replace function public.loss_reasons_breakdown(
  p_from date default null,
  p_to date default null,
  p_customer_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'count', count(*),
    'records', coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'reason', coalesce(r.pass_reason, 'NO_REASON'))), '[]'::jsonb)
  )
  from public.requirement r
  where r.status in ('lost', 'cancelled')
    and (p_from is null or r.enquiry_date >= p_from)
    and (p_to is null or r.enquiry_date <= p_to)
    and (p_customer_id is null or r.customer_id = p_customer_id);
$$;

grant execute on function public.loss_reasons_breakdown(date, date, uuid) to authenticated;

create or replace function public.orders_at_delivery_risk(
  p_risk_status text[] default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'count', count(*),
    'records', coalesce(jsonb_agg(jsonb_build_object('id', id, 'status', status)), '[]'::jsonb)
  )
  from public.customer_po
  where (
    p_risk_status is null
    or status::text = any (p_risk_status)
  );
$$;

grant execute on function public.orders_at_delivery_risk(text[]) to authenticated;

create or replace function public.pending_oem_responses(
  p_overdue_only boolean default false
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'count', count(*),
    'records', coalesce(jsonb_agg(jsonb_build_object('id', id, 'status', status)), '[]'::jsonb)
  )
  from public.requirement
  where status in ('qualifying', 'quoted')
    and (not p_overdue_only or true);
$$;

grant execute on function public.pending_oem_responses(boolean) to authenticated;

create or replace function public.overdue_payments(
  p_min_days integer default 1
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'count', count(*),
    'records', coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'due_date', i.due_date)), '[]'::jsonb)
  )
  from public.invoice i
  where i.due_date is not null
    and i.due_date < current_date
    and (current_date - i.due_date) >= p_min_days;
$$;

grant execute on function public.overdue_payments(integer) to authenticated;

create or replace function public.expiring_approvals(
  p_within_days integer default 90
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'count', count(*),
    'records', coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'decided_at', a.decided_at)), '[]'::jsonb)
  )
  from public.approval a
  where a.decision = 'pending'
    and a.requested_at <= now() + (p_within_days || ' days')::interval;
$$;

grant execute on function public.expiring_approvals(integer) to authenticated;

create or replace function public.pending_quotations()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'count', count(*),
    'records', coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'status', qv.status)), '[]'::jsonb)
  )
  from public.quotation q
  join public.quotation_version qv on qv.quotation_id = q.id
  where qv.status in ('draft', 'pending_approval', 'approved', 'submitted');
$$;

grant execute on function public.pending_quotations() to authenticated;

create or replace function public.coverage_gaps(
  p_requirement_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'count', count(*),
    'records', coalesce(
      jsonb_agg(jsonb_build_object(
        'id', c.requirement_line_id,
        'requirement_id', c.requirement_id,
        'line_no', c.line_no,
        'qty_uncovered', c.qty_uncovered
      )),
      '[]'::jsonb
    )
  )
  from public.v_requirement_line_coverage c
  where c.qty_uncovered > 0
    and (p_requirement_id is null or c.requirement_id = p_requirement_id);
$$;

grant execute on function public.coverage_gaps(uuid) to authenticated;
