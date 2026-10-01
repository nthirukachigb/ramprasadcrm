-- Defence Contract CRM — Phase 6: Tasks and in-app notifications (T6.2)
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
