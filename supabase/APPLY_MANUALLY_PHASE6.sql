-- ===========================================================================
-- Defence Contract CRM - Phase 6 (Response, tasks, win/loss) - APPLY MANUALLY
-- ---------------------------------------------------------------------------
-- Run APPLY_MANUALLY_PHASE5.sql first, then paste this file into the Supabase
-- SQL Editor and run it. Idempotent (safe to re-run).
--   0016_customer_response.sql 0017_tasks.sql 0018_outcome.sql 0019_jobs.sql
-- ===========================================================================

-- >>> supabase/migrations/0016_customer_response.sql
-- Defence Contract CRM â€” Phase 6: Customer response and negotiation (T6.1)
-- Post-submission states (PRD Â§21.6) and PNC events. State changes reuse the
-- status_history + ref_status_transition pattern.
-- Idempotent. Depends on 0014_quotation_workflow.sql.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'customer_response_status') then
    create type public.customer_response_status as enum (
      'submitted', 'clarification_requested', 'technical_clarification',
      'commercial_negotiation', 'awaiting_decision',
      'won', 'partially_won', 'lost', 'cancelled'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'negotiation_event_type') then
    create type public.negotiation_event_type as enum
      ('clarification', 'technical', 'commercial', 'pnc', 'other');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. customer_response (one live response per quotation; Â§21.6)
-- ---------------------------------------------------------------------------
create table if not exists public.customer_response (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.quotation (id) on delete cascade,
  status public.customer_response_status not null default 'submitted',
  response_date date not null default current_date,
  comments text,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_response_quotation_idx
  on public.customer_response (quotation_id);

create table if not exists public.negotiation_event (
  id uuid primary key default gen_random_uuid(),
  customer_response_id uuid not null
    references public.customer_response (id) on delete cascade,
  event_date date not null default current_date,
  event_type public.negotiation_event_type not null default 'other',
  detail text,
  price_change_requested boolean not null default false,
  requested_price numeric(14, 4) check (requested_price is null or requested_price >= 0),
  agreed boolean not null default false,
  approved_version_id uuid references public.quotation_version (id) on delete set null,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists negotiation_event_response_idx
  on public.negotiation_event (customer_response_id);

-- A lower/agreed PNC price must point at an approved quotation version (FR-RESP-03).
create or replace function public.check_pnc_agreement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.quotation_status;
begin
  if new.agreed and new.price_change_requested then
    if new.approved_version_id is null then
      raise exception
        'FR-RESP-03: an agreed price change needs a new approved quotation version';
    end if;
    select status into v_status
    from public.quotation_version where id = new.approved_version_id;
    if v_status not in ('approved', 'submitted') then
      raise exception
        'FR-RESP-03: the linked version is not approved';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists negotiation_event_pnc on public.negotiation_event;
create trigger negotiation_event_pnc
  before insert or update on public.negotiation_event
  for each row execute function public.check_pnc_agreement();

-- ---------------------------------------------------------------------------
-- 2. Allowed response transitions (Â§21.6)
-- ---------------------------------------------------------------------------
insert into public.ref_status_transition (entity, from_status, to_status, requires_approval)
values
  ('customer_response', 'submitted', 'clarification_requested', false),
  ('customer_response', 'submitted', 'technical_clarification', false),
  ('customer_response', 'submitted', 'commercial_negotiation', false),
  ('customer_response', 'submitted', 'awaiting_decision', false),
  ('customer_response', 'submitted', 'won', false),
  ('customer_response', 'submitted', 'partially_won', false),
  ('customer_response', 'submitted', 'lost', false),
  ('customer_response', 'submitted', 'cancelled', false),
  ('customer_response', 'clarification_requested', 'technical_clarification', false),
  ('customer_response', 'clarification_requested', 'commercial_negotiation', false),
  ('customer_response', 'clarification_requested', 'awaiting_decision', false),
  ('customer_response', 'clarification_requested', 'cancelled', false),
  ('customer_response', 'technical_clarification', 'commercial_negotiation', false),
  ('customer_response', 'technical_clarification', 'awaiting_decision', false),
  ('customer_response', 'technical_clarification', 'cancelled', false),
  ('customer_response', 'commercial_negotiation', 'awaiting_decision', false),
  ('customer_response', 'commercial_negotiation', 'won', false),
  ('customer_response', 'commercial_negotiation', 'partially_won', false),
  ('customer_response', 'commercial_negotiation', 'lost', false),
  ('customer_response', 'commercial_negotiation', 'cancelled', false),
  ('customer_response', 'awaiting_decision', 'won', false),
  ('customer_response', 'awaiting_decision', 'partially_won', false),
  ('customer_response', 'awaiting_decision', 'lost', false),
  ('customer_response', 'awaiting_decision', 'cancelled', false)
on conflict (entity, from_status, to_status) do nothing;

create or replace function public.transition_customer_response(
  p_id uuid,
  p_to_status public.customer_response_status,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resp public.customer_response;
  v_allowed boolean;
  v_requirement uuid;
  v_req_status public.requirement_status;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.has_any_role(
    array['owner', 'sales', 'operations', 'admin']::public.app_role[]
  ) then
    raise exception 'FORBIDDEN: you may not change a customer response';
  end if;

  select * into v_resp from public.customer_response where id = p_id for update;
  if not found then
    raise exception 'Customer response not found';
  end if;

  select true into v_allowed
  from public.ref_status_transition t
  where t.entity = 'customer_response'
    and t.from_status = v_resp.status::text
    and t.to_status = p_to_status::text;
  if v_allowed is null then
    raise exception 'BR-30: invalid customer response transition from % to %',
      v_resp.status, p_to_status;
  end if;

  update public.customer_response
     set status = p_to_status, response_date = current_date, updated_at = now()
   where id = p_id;

  insert into public.status_history
    (entity_type, entity_id, from_status, to_status, actor, reason)
  values
    ('customer_response', p_id, v_resp.status::text, p_to_status::text, auth.uid(), p_reason);

  -- A terminal customer outcome also moves the requirement (submitted â†’ outcome).
  if p_to_status in ('won', 'partially_won', 'lost', 'cancelled') then
    select q.requirement_id into v_requirement
    from public.quotation q where q.id = v_resp.quotation_id;
    select status into v_req_status from public.requirement where id = v_requirement;
    if v_req_status = 'submitted' then
      perform public.transition_requirement(
        v_requirement, p_to_status::text::public.requirement_status, p_reason);
    end if;
  end if;
end;
$$;

grant execute on function public.transition_customer_response(uuid, public.customer_response_status, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Audit, updated_at, row_version and actor stamping
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
declare
  t text;
begin
  foreach t in array array['customer_response', 'negotiation_event'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t, t);
    execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
    execute format('drop trigger if exists %I_row_version on public.%I', t, t);
    execute format('create trigger %I_row_version before update on public.%I for each row execute function public.bump_row_version()', t, t);
    execute format('drop trigger if exists %I_stamp_actor on public.%I', t, t);
    execute format('create trigger %I_stamp_actor before insert or update on public.%I for each row execute function public.stamp_actor()', t, t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Row Level Security and grants
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  v_write text := 'public.has_any_role(array[''owner'',''sales'',''operations'',''admin'']::public.app_role[])';
begin
  foreach t in array array['customer_response', 'negotiation_event'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select to authenticated using (true)', t, t);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format('create policy %I_insert on public.%I for insert to authenticated with check (%s)', t, t, v_write);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format('create policy %I_update on public.%I for update to authenticated using (%s) with check (%s)', t, t, v_write, v_write);
    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format('create policy %I_delete on public.%I for delete to authenticated using (%s)', t, t, v_write);
  end loop;
end
$$;

grant select, insert, update, delete on public.customer_response to authenticated;
grant select, insert, update, delete on public.negotiation_event to authenticated;

-- >>> supabase/migrations/0017_tasks.sql
-- Defence Contract CRM â€” Phase 6: Tasks and in-app notifications (T6.2)
-- Follow-ups as owned tasks with dedupe, and an in-app notification centre.
-- Formalises and replaces pending_notification (T3.4). No external sending.
-- Idempotent. Depends on 0016_customer_response.sql.

-- ---------------------------------------------------------------------------
-- 1. task_rule
-- ---------------------------------------------------------------------------
create table if not exists public.task_rule (
  rule_id text primary key,
  name text not null,
  description text,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.task_rule (rule_id, name, description, enabled)
values
  ('deadline_tbc', 'Confirm submission deadline', 'A requirement with "deadline TBC".', true),
  ('clarification_open', 'Answer an open clarification', 'A clarification raised on a requirement.', true),
  ('quotation_deadline', 'Quotation preparation deadline', 'Reminder before the submission deadline.', true),
  ('customer_no_response', 'Customer has not responded', 'No response 7 days after submission.', true),
  ('oem_response_followup', 'Chase an OEM response', 'A sourcing request is past its due date.', true),
  ('quotation_validity', 'Quotation validity expiring', 'An approved quotation is nearing its validity.', true),
  ('commitment_expiry', 'Commitment expiring', 'A firm OEM commitment is nearing its valid-until.', true)
on conflict (rule_id) do nothing;

alter table public.task_rule enable row level security;
drop policy if exists task_rule_select on public.task_rule;
create policy task_rule_select on public.task_rule
  for select to authenticated using (true);
drop policy if exists task_rule_admin on public.task_rule;
create policy task_rule_admin on public.task_rule
  for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

-- ---------------------------------------------------------------------------
-- 2. task
-- ---------------------------------------------------------------------------
create table if not exists public.task (
  id uuid primary key default gen_random_uuid(),
  rule_id text references public.task_rule (rule_id),
  source_entity_type text not null,
  source_entity_id uuid not null,
  title text not null,
  owner_user_id uuid references public.profiles (id) on delete set null,
  due_date date,
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  notes text,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists task_owner_idx on public.task (owner_user_id, status);
create index if not exists task_source_idx on public.task (source_entity_type, source_entity_id);
create unique index if not exists task_rule_entity_open_uidx
  on public.task (rule_id, source_entity_id, due_date)
  where status = 'open';

-- Create a task unless an identical open one already exists (FR-TASK-02).
create or replace function public.ensure_task(
  p_rule_id text,
  p_entity_type text,
  p_entity_id uuid,
  p_title text,
  p_owner uuid,
  p_due date,
  p_priority text default 'medium'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_rule_id is not null
     and exists (
       select 1 from public.task
       where rule_id = p_rule_id
         and source_entity_id = p_entity_id
         and coalesce(due_date, '0001-01-01') = coalesce(p_due, '0001-01-01')
         and status = 'open'
     ) then
    return null;
  end if;

  insert into public.task
    (rule_id, source_entity_type, source_entity_id, title, owner_user_id, due_date, priority)
  values
    (p_rule_id, p_entity_type, p_entity_id, p_title, p_owner, p_due, p_priority)
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.ensure_task(text, text, uuid, text, uuid, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. notification (replaces pending_notification)
-- ---------------------------------------------------------------------------
create table if not exists public.notification (
  id uuid primary key default gen_random_uuid(),
  notification_type text not null,
  subject_type text,
  subject_id uuid,
  payload jsonb not null default '{}'::jsonb,
  recipient_user_id uuid references public.profiles (id) on delete set null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notification_recipient_idx
  on public.notification (recipient_user_id, is_read, created_at desc);

alter table public.notification enable row level security;
drop policy if exists notification_select on public.notification;
create policy notification_select on public.notification
  for select to authenticated
  using (
    recipient_user_id is null
    or recipient_user_id = auth.uid()
    or public.has_any_role(array['owner', 'admin']::public.app_role[])
  );
drop policy if exists notification_update on public.notification;
create policy notification_update on public.notification
  for update to authenticated
  using (recipient_user_id = auth.uid() or public.has_any_role(array['owner', 'admin']::public.app_role[]))
  with check (recipient_user_id = auth.uid() or public.has_any_role(array['owner', 'admin']::public.app_role[]));

-- Point the commitment-change trigger at the new table.
create or replace function public.notify_commitment_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('changed', 'withdrawn')
     and old.status is distinct from new.status then
    insert into public.notification
      (notification_type, subject_type, subject_id, payload)
    values (
      'commitment_' || new.status,
      'quantity_commitment',
      new.id,
      jsonb_build_object(
        'requirement_line_id', new.requirement_line_id,
        'partner_id', new.partner_id,
        'old_qty', old.qty_committed,
        'new_qty', new.qty_committed,
        'version', new.version
      )
    );
  end if;
  return new;
end;
$$;

-- Migrate any pending_notification rows and drop the old table.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'pending_notification'
  ) then
    insert into public.notification
      (notification_type, subject_type, subject_id, payload, created_at)
    select notification_type, subject_type, subject_id, payload, created_at
    from public.pending_notification;
    drop table public.pending_notification;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Hooks: deadline-TBC and open-clarification tasks
-- ---------------------------------------------------------------------------
create or replace function public.task_on_requirement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.deadline_tbc
     and new.submission_deadline is null
     and new.status in ('received', 'qualifying', 'in_preparation') then
    perform public.ensure_task(
      'deadline_tbc', 'requirement', new.id,
      'Confirm the submission deadline for ' || new.internal_ref,
      new.assigned_user_id, current_date + 1, 'medium');
  end if;
  return new;
end;
$$;

drop trigger if exists requirement_task_hook on public.requirement;
create trigger requirement_task_hook
  after insert or update on public.requirement
  for each row execute function public.task_on_requirement();

create or replace function public.task_on_clarification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'open' then
    perform public.ensure_task(
      'clarification_open', 'clarification', new.id,
      'Clarify: ' || new.subject,
      new.owner_user_id, coalesce(new.due_date, current_date + 3), 'medium');
  end if;
  return new;
end;
$$;

drop trigger if exists clarification_task_hook on public.clarification;
create trigger clarification_task_hook
  after insert or update on public.clarification
  for each row execute function public.task_on_clarification();

-- ---------------------------------------------------------------------------
-- 5. Audit, updated_at, row_version and actor stamping
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
declare
  t text;
begin
  foreach t in array array['task'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t, t);
    execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
    execute format('drop trigger if exists %I_row_version on public.%I', t, t);
    execute format('create trigger %I_row_version before update on public.%I for each row execute function public.bump_row_version()', t, t);
    execute format('drop trigger if exists %I_stamp_actor on public.%I', t, t);
    execute format('create trigger %I_stamp_actor before insert or update on public.%I for each row execute function public.stamp_actor()', t, t);
  end loop;

  execute 'drop trigger if exists task_rule_updated_at on public.task_rule';
  execute 'create trigger task_rule_updated_at before update on public.task_rule for each row execute function public.set_updated_at()';
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Row Level Security and grants for task
-- ---------------------------------------------------------------------------
alter table public.task enable row level security;
drop policy if exists task_select on public.task;
create policy task_select on public.task
  for select to authenticated using (true);
drop policy if exists task_write on public.task;
create policy task_write on public.task
  for all to authenticated
  using (public.has_any_role(array['owner','sales','operations','admin']::public.app_role[]))
  with check (public.has_any_role(array['owner','sales','operations','admin']::public.app_role[]));

grant select, insert, update, delete on public.task to authenticated;
grant select on public.task_rule to authenticated;
grant select, update on public.notification to authenticated;

-- >>> supabase/migrations/0018_outcome.sql
-- Defence Contract CRM â€” Phase 6: Outcome, partial award and loss reasons (T6.4)
-- Structured won/lost/cancelled outcomes per line; the header outcome is
-- derived. A loss or no-bid needs a reason (BR-29); "Other" needs text.
-- Idempotent. Depends on 0016_customer_response.sql.

-- ---------------------------------------------------------------------------
-- 1. loss_reason reference list
-- ---------------------------------------------------------------------------
create table if not exists public.loss_reason (
  code text primary key,
  label text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0
);

insert into public.loss_reason (code, label, sort_order)
values
  ('PRICE', 'Price', 10),
  ('DELIVERY', 'Delivery / lead time', 20),
  ('TECHNICAL', 'Technical non-compliance', 30),
  ('COMPLIANCE', 'Compliance / documentation', 40),
  ('QTY_SPLIT', 'Quantity split (part won)', 50),
  ('NO_RESPONSE', 'No customer response', 60),
  ('COMPETITOR', 'Competitor', 70),
  ('CUSTOMER_CANCELLED', 'Customer cancelled', 80),
  ('OTHER', 'Other', 90)
on conflict (code) do nothing;

alter table public.loss_reason enable row level security;
drop policy if exists loss_reason_select on public.loss_reason;
create policy loss_reason_select on public.loss_reason
  for select to authenticated using (true);
drop policy if exists loss_reason_admin on public.loss_reason;
create policy loss_reason_admin on public.loss_reason
  for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

-- ---------------------------------------------------------------------------
-- 2. line_outcome
-- ---------------------------------------------------------------------------
create table if not exists public.line_outcome (
  id uuid primary key default gen_random_uuid(),
  quotation_version_id uuid not null
    references public.quotation_version (id) on delete cascade,
  requirement_line_id uuid not null
    references public.requirement_line (id) on delete cascade,
  outcome text not null check (
    outcome in ('won', 'partially_won', 'lost', 'not_pursued', 'cancelled')
  ),
  qty_won numeric(14, 3) not null default 0 check (qty_won >= 0),
  qty_lost numeric(14, 3) not null default 0 check (qty_lost >= 0),
  loss_reason_code text references public.loss_reason (code),
  loss_reason_other text,
  competitor_partner_id uuid references public.partner (id) on delete set null,
  winning_price numeric(14, 4) check (winning_price is null or winning_price >= 0),
  l_position text,
  notes text,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quotation_version_id, requirement_line_id),
  constraint line_outcome_reason_chk check (
    outcome not in ('lost', 'not_pursued') or loss_reason_code is not null
  ),
  constraint line_outcome_other_chk check (
    loss_reason_code is distinct from 'OTHER'
    or (loss_reason_other is not null and length(btrim(loss_reason_other)) >= 3)
  )
);

create index if not exists line_outcome_version_idx
  on public.line_outcome (quotation_version_id);
create index if not exists line_outcome_line_idx
  on public.line_outcome (requirement_line_id);

-- The awarded quantity cannot exceed the quoted quantity (FR-RESP-04).
create or replace function public.check_line_outcome_qty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quoted numeric;
begin
  select qty_quoted into v_quoted
  from public.quotation_line
  where quotation_version_id = new.quotation_version_id
    and requirement_line_id = new.requirement_line_id;

  if v_quoted is null then
    raise exception 'FR-RESP-04: there is no quoted line for this outcome';
  end if;
  if new.qty_won > v_quoted then
    raise exception 'FR-RESP-04: awarded quantity % exceeds quoted %', new.qty_won, v_quoted;
  end if;
  if new.outcome = 'lost'
     and new.loss_reason_code is null then
    raise exception 'BR-29: a lost line needs a loss reason';
  end if;
  return new;
end;
$$;

drop trigger if exists line_outcome_qty on public.line_outcome;
create trigger line_outcome_qty
  before insert or update on public.line_outcome
  for each row execute function public.check_line_outcome_qty();

-- ---------------------------------------------------------------------------
-- 3. Derived requirement outcome
-- ---------------------------------------------------------------------------
create or replace view public.v_requirement_outcome
with (security_invoker = true) as
select
  rl.requirement_id                    as requirement_id,
  sum(ql.qty_quoted)                   as qty_quoted,
  coalesce(sum(lo.qty_won), 0)         as qty_won,
  coalesce(sum(lo.qty_lost), 0)        as qty_lost,
  bool_or(lo.loss_reason_code = 'QTY_SPLIT') as has_qty_split,
  case
    when coalesce(sum(lo.qty_won), 0) > 0 and coalesce(sum(lo.qty_lost), 0) > 0
      then 'partially_won'
    when coalesce(sum(lo.qty_won), 0) > 0
      then 'won'
    when coalesce(sum(lo.qty_lost), 0) > 0
      then 'lost'
    else 'awaiting'
  end                                  as derived_outcome
from public.line_outcome lo
join public.quotation_version qv on qv.id = lo.quotation_version_id
join public.quotation_line ql
  on ql.quotation_version_id = lo.quotation_version_id
 and ql.requirement_line_id = lo.requirement_line_id
join public.requirement_line rl on rl.id = lo.requirement_line_id
group by rl.requirement_id;

grant select on public.v_requirement_outcome to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Audit, updated_at, row_version and actor stamping
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
declare
  t text;
begin
  foreach t in array array['line_outcome'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t, t);
    execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
    execute format('drop trigger if exists %I_row_version on public.%I', t, t);
    execute format('create trigger %I_row_version before update on public.%I for each row execute function public.bump_row_version()', t, t);
    execute format('drop trigger if exists %I_stamp_actor on public.%I', t, t);
    execute format('create trigger %I_stamp_actor before insert or update on public.%I for each row execute function public.stamp_actor()', t, t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Row Level Security and grants
-- ---------------------------------------------------------------------------
alter table public.line_outcome enable row level security;
drop policy if exists line_outcome_select on public.line_outcome;
create policy line_outcome_select on public.line_outcome
  for select to authenticated using (true);
drop policy if exists line_outcome_write on public.line_outcome;
create policy line_outcome_write on public.line_outcome
  for all to authenticated
  using (public.has_any_role(array['owner','sales','operations','admin']::public.app_role[]))
  with check (public.has_any_role(array['owner','sales','operations','admin']::public.app_role[]));

grant select, insert, update, delete on public.line_outcome to authenticated;

-- >>> supabase/migrations/0019_jobs.sql
-- Defence Contract CRM â€” Phase 6: Scheduled job framework (T6.3)
-- Idempotent, set-based reminder jobs with a job_run log and a manual trigger.
-- Designed for pg_cron, with a Vercel Cron fallback (/api/cron/[job]).
-- Idempotent. Depends on 0017_tasks.sql.

-- ---------------------------------------------------------------------------
-- 1. app_now() â€” testable clock (override with app_setting.now_override)
-- ---------------------------------------------------------------------------
create or replace function public.app_now()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select nullif(value_text, '')::timestamptz from public.app_setting where key = 'now_override'),
    now()
  );
$$;

grant execute on function public.app_now() to authenticated;

insert into public.app_setting (key, value_num, description)
values
  ('quotation_deadline_days', 3, 'Days before the submission deadline to prompt quotation preparation.'),
  ('no_response_days', 7, 'Days after submission before chasing a customer response (FR-RESP-02).'),
  ('quotation_validity_days', 14, 'Days before a quotation validity expires to prompt.'),
  ('commitment_expiry_days', 7, 'Days before a commitment valid-until to prompt.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. job_run log
-- ---------------------------------------------------------------------------
create table if not exists public.job_run (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  status text not null default 'running'
    check (status in ('running', 'success', 'failed', 'skipped')),
  created_count integer not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  triggered_by text
);

create index if not exists job_run_name_idx on public.job_run (job_name, started_at desc);

alter table public.job_run enable row level security;
drop policy if exists job_run_select on public.job_run;
create policy job_run_select on public.job_run
  for select to authenticated
  using (public.has_any_role(array['owner', 'admin']::public.app_role[]));

grant select on public.job_run to authenticated;

-- ---------------------------------------------------------------------------
-- 3. run_job â€” dispatch, dedupe and log
-- ---------------------------------------------------------------------------
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
      insert into public.task
        (rule_id, source_entity_type, source_entity_id, title, owner_user_id, due_date, priority)
      select 'quotation_deadline', 'requirement', r.id,
             'Prepare quotation for ' || r.internal_ref,
             r.assigned_user_id, public.app_now()::date, 'high'
      from public.requirement r
      where r.submission_deadline is not null
        and r.status not in ('submitted','won','partially_won','lost','not_pursued','cancelled','closed')
        and r.submission_deadline between public.app_now()
            and public.app_now() + make_interval(days => v_days)
        and not exists (
          select 1 from public.task t
          where t.rule_id = 'quotation_deadline' and t.source_entity_id = r.id and t.status = 'open'
        );
      get diagnostics v_count = row_count;

    elsif p_job = 'customer_no_response' then
      v_days := coalesce(public.setting_num('no_response_days', 7), 7)::integer;
      insert into public.task
        (rule_id, source_entity_type, source_entity_id, title, owner_user_id, due_date, priority)
      select 'customer_no_response', 'quotation', q.id,
             'Chase customer response for ' || coalesce(q.internal_quote_no, q.id::text),
             r.assigned_user_id, public.app_now()::date, 'high'
      from public.quotation q
      join public.requirement r on r.id = q.requirement_id
      join public.quotation_version qv on qv.id = q.current_version_id and qv.status = 'submitted'
      join public.customer_response cr on cr.quotation_id = q.id and cr.status = 'submitted'
      where qv.submitted_at is not null
        and qv.submitted_at <= public.app_now() - make_interval(days => v_days)
        and not exists (
          select 1 from public.task t
          where t.rule_id = 'customer_no_response' and t.source_entity_id = q.id and t.status = 'open'
        );
      get diagnostics v_count = row_count;

    elsif p_job = 'oem_response_followup' then
      insert into public.task
        (rule_id, source_entity_type, source_entity_id, title, owner_user_id, due_date, priority)
      select 'oem_response_followup', 'sourcing_request', sr.id,
             'Chase OEM response for ' || coalesce(p.name, sr.partner_id::text),
             r.assigned_user_id, public.app_now()::date, 'medium'
      from public.sourcing_request sr
      join public.requirement r on r.id = sr.requirement_id
      join public.partner p on p.id = sr.partner_id
      where sr.status in ('sent', 'overdue')
        and sr.response_due_date is not null
        and sr.response_due_date < public.app_now()::date
        and not exists (
          select 1 from public.task t
          where t.rule_id = 'oem_response_followup' and t.source_entity_id = sr.id and t.status = 'open'
        );
      get diagnostics v_count = row_count;

    elsif p_job = 'quotation_validity' then
      v_days := coalesce(public.setting_num('quotation_validity_days', 14), 14)::integer;
      insert into public.task
        (rule_id, source_entity_type, source_entity_id, title, owner_user_id, due_date, priority)
      select 'quotation_validity', 'quotation', q.id,
             'Quotation validity expiring for ' || coalesce(q.internal_quote_no, q.id::text),
             r.assigned_user_id, qv.valid_until, 'medium'
      from public.quotation q
      join public.requirement r on r.id = q.requirement_id
      join public.quotation_version qv on qv.id = q.current_version_id and qv.status = 'approved'
      where qv.valid_until is not null
        and qv.valid_until between public.app_now()::date
            and public.app_now()::date + v_days
        and not exists (
          select 1 from public.task t
          where t.rule_id = 'quotation_validity' and t.source_entity_id = q.id and t.status = 'open'
        );
      get diagnostics v_count = row_count;

    elsif p_job = 'commitment_expiry' then
      v_days := coalesce(public.setting_num('commitment_expiry_days', 7), 7)::integer;
      insert into public.task
        (rule_id, source_entity_type, source_entity_id, title, owner_user_id, due_date, priority)
      select 'commitment_expiry', 'quantity_commitment', qc.id,
             'Commitment expiring',
             null, qc.valid_until, 'medium'
      from public.quantity_commitment qc
      where qc.status = 'active'
        and qc.valid_until is not null
        and qc.valid_until between public.app_now()::date
            and public.app_now()::date + v_days
        and not exists (
          select 1 from public.task t
          where t.rule_id = 'commitment_expiry' and t.source_entity_id = qc.id and t.status = 'open'
        );
      get diagnostics v_count = row_count;
    end if;

    update public.job_run
       set status = 'success', created_count = v_count, finished_at = now()
     where id = v_run;
  exception when others then
    update public.job_run
       set status = 'failed', error = sqlerrm, finished_at = now()
     where id = v_run;
    raise;
  end;

  return v_count;
end;
$$;

grant execute on function public.run_job(text, text) to authenticated;

-- Ask PostgREST to pick up the new functions and views immediately.
notify pgrst, 'reload schema';
