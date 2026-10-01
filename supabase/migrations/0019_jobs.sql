-- Defence Contract CRM — Phase 6: Scheduled job framework (T6.3)
-- Idempotent, set-based reminder jobs with a job_run log and a manual trigger.
-- Designed for pg_cron, with a Vercel Cron fallback (/api/cron/[job]).
-- Idempotent. Depends on 0017_tasks.sql.

-- ---------------------------------------------------------------------------
-- 1. app_now() — testable clock (override with app_setting.now_override)
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
-- 3. run_job — dispatch, dedupe and log
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
