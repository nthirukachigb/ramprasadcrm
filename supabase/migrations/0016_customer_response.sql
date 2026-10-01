-- Defence Contract CRM — Phase 6: Customer response and negotiation (T6.1)
-- Post-submission states (PRD §21.6) and PNC events. State changes reuse the
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
-- 1. customer_response (one live response per quotation; §21.6)
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
-- 2. Allowed response transitions (§21.6)
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

  -- A terminal customer outcome also moves the requirement (submitted → outcome).
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
