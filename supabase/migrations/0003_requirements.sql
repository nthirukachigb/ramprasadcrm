-- Defence Contract CRM — Phase 2: Requirement / RFI (T2.1)
-- Requirement header with controlled status + up to 500 line items, plus the
-- supporting framework Phase 2 relies on: settings, human-readable numbering,
-- status transitions/history and a human approval gate.
-- Idempotent: safe to run more than once. Depends on 0001_foundation.sql and
-- 0002_masters.sql.

-- ---------------------------------------------------------------------------
-- 1. Application settings (typed key/value)
-- ---------------------------------------------------------------------------
create table if not exists public.app_setting (
  key text primary key,
  value_text text,
  value_num numeric,
  value_bool boolean,
  description text,
  updated_at timestamptz not null default now()
);

insert into public.app_setting (key, value_num, value_bool, description)
values
  ('max_lines', 500, null, 'Hard maximum number of line items per requirement (FR-RFI-02).'),
  ('pass_requires_owner', null, true, 'A Pass / Not pursued decision requires Owner approval (Q-25).'),
  ('quotation_validity_default_days', 30, null, 'Default quotation validity when the customer does not state one.')
on conflict (key) do nothing;

alter table public.app_setting enable row level security;
drop policy if exists app_setting_select on public.app_setting;
create policy app_setting_select on public.app_setting
  for select to authenticated using (true);
drop policy if exists app_setting_admin_write on public.app_setting;
create policy app_setting_admin_write on public.app_setting
  for all to authenticated
  using (public.has_any_role(array['owner', 'admin']::public.app_role[]))
  with check (public.has_any_role(array['owner', 'admin']::public.app_role[]));

create or replace function public.setting_num(p_key text, p_default numeric default null)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select value_num from public.app_setting where key = p_key),
    p_default
  );
$$;

create or replace function public.setting_bool(p_key text, p_default boolean default null)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select value_bool from public.app_setting where key = p_key),
    p_default
  );
$$;

grant execute on function public.setting_num(text, numeric) to authenticated;
grant execute on function public.setting_bool(text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Human-readable numbering (FR-RFI-03, FR-QUOTE-11)
-- ---------------------------------------------------------------------------
create table if not exists public.ref_sequence (
  kind text not null,
  fy text not null,
  next_value integer not null default 0,
  primary key (kind, fy)
);

alter table public.ref_sequence enable row level security;
-- No policies: only SECURITY DEFINER functions touch this table.

-- Indian financial year label for a timestamp, in IST (e.g. 2026-05 -> 26-27).
create or replace function public.current_fy(p_at timestamptz default now())
returns text
language sql
immutable
as $$
  select case
    when extract(month from (p_at at time zone 'Asia/Kolkata')) >= 4
      then to_char(p_at at time zone 'Asia/Kolkata', 'YY')
           || '-' ||
           to_char((p_at at time zone 'Asia/Kolkata') + interval '1 year', 'YY')
    else to_char((p_at at time zone 'Asia/Kolkata') - interval '1 year', 'YY')
         || '-' ||
         to_char(p_at at time zone 'Asia/Kolkata', 'YY')
  end;
$$;

-- Gap-free, race-free reference generator. Row locking is provided by the
-- ON CONFLICT update, so two concurrent callers get different values.
create or replace function public.next_ref(p_kind text, p_fy text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fy text := coalesce(p_fy, public.current_fy());
  v_n integer;
begin
  insert into public.ref_sequence (kind, fy, next_value)
  values (p_kind, v_fy, 1)
  on conflict (kind, fy)
    do update set next_value = public.ref_sequence.next_value + 1
  returning next_value into v_n;

  return p_kind || '/' || v_fy || '/' || lpad(v_n::text, 4, '0');
end;
$$;

grant execute on function public.next_ref(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Status history (FR-RFI-07, FR-AUDIT-02)
-- ---------------------------------------------------------------------------
create table if not exists public.status_history (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  from_status text,
  to_status text not null,
  actor uuid,
  reason text,
  approval_id uuid,
  occurred_at timestamptz not null default now()
);

create index if not exists status_history_entity_idx
  on public.status_history (entity_type, entity_id, occurred_at);

alter table public.status_history enable row level security;
drop policy if exists status_history_select on public.status_history;
create policy status_history_select on public.status_history
  for select to authenticated using (true);
-- Append-only: no insert/update/delete policy. Rows are written only by
-- SECURITY DEFINER transition functions.

-- Allowed transitions, seeded per PRD §21. Seeded idempotently below.
create table if not exists public.ref_status_transition (
  entity text not null,
  from_status text not null,
  to_status text not null,
  requires_approval boolean not null default false,
  primary key (entity, from_status, to_status)
);

alter table public.ref_status_transition enable row level security;
drop policy if exists ref_status_transition_select on public.ref_status_transition;
create policy ref_status_transition_select on public.ref_status_transition
  for select to authenticated using (true);
drop policy if exists ref_status_transition_admin on public.ref_status_transition;
create policy ref_status_transition_admin on public.ref_status_transition
  for all to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

insert into public.ref_status_transition (entity, from_status, to_status, requires_approval)
values
  ('requirement', 'received',        'qualifying',    false),
  ('requirement', 'received',        'not_pursued',   true),
  ('requirement', 'received',        'cancelled',     false),
  ('requirement', 'qualifying',      'in_preparation', false),
  ('requirement', 'qualifying',      'not_pursued',   true),
  ('requirement', 'qualifying',      'cancelled',     false),
  ('requirement', 'in_preparation',  'quoted',        false),
  ('requirement', 'in_preparation',  'not_pursued',   true),
  ('requirement', 'in_preparation',  'cancelled',     false),
  ('requirement', 'quoted',          'submitted',     false),
  ('requirement', 'quoted',          'in_preparation', false),
  ('requirement', 'quoted',          'cancelled',     false),
  ('requirement', 'submitted',       'won',           false),
  ('requirement', 'submitted',       'partially_won', false),
  ('requirement', 'submitted',       'lost',          false),
  ('requirement', 'submitted',       'cancelled',     false),
  ('requirement', 'won',             'closed',        false),
  ('requirement', 'partially_won',   'closed',        false)
on conflict (entity, from_status, to_status) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Approval framework (T2.4, FR-AUDIT-03)
-- ---------------------------------------------------------------------------
create table if not exists public.approval (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null,
  subject_id uuid not null,
  requested_by uuid not null,
  approver_id uuid,
  decision text not null default 'pending'
    check (decision in ('pending', 'approved', 'rejected')),
  comment text,
  reason text,
  snapshot jsonb,
  requested_at timestamptz not null default now(),
  decided_at timestamptz
);

create index if not exists approval_subject_idx
  on public.approval (subject_type, subject_id);
create index if not exists approval_pending_idx
  on public.approval (decision, requested_at desc);

alter table public.approval enable row level security;
drop policy if exists approval_select on public.approval;
create policy approval_select on public.approval
  for select to authenticated
  using (
    requested_by = auth.uid()
    or approver_id = auth.uid()
    or public.has_any_role(array['owner', 'admin']::public.app_role[])
  );
-- Decisions are written only through the RPCs below (SECURITY DEFINER).

create or replace function public.request_approval(
  p_subject_type text,
  p_subject_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if p_subject_type is null or btrim(p_subject_type) = '' then
    raise exception 'A subject type is required';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'A reason of at least 3 characters is required';
  end if;

  insert into public.approval (subject_type, subject_id, requested_by, reason)
  values (p_subject_type, p_subject_id, auth.uid(), p_reason)
  returning id into v_id;

  perform set_config('app.audit_reason', p_reason, true);

  return v_id;
end;
$$;

create or replace function public.decide_approval(
  p_approval_id uuid,
  p_decision text,
  p_comment text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_approval public.approval;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.has_any_role(array['owner', 'admin']::public.app_role[]) then
    raise exception 'FORBIDDEN: only the Owner or Admin may decide an approval';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Invalid decision: expected approved or rejected';
  end if;
  if p_comment is null or length(btrim(p_comment)) < 3 then
    raise exception 'A comment of at least 3 characters is required';
  end if;

  select * into v_approval from public.approval where id = p_approval_id for update;
  if not found then
    raise exception 'Approval not found';
  end if;
  if v_approval.decision <> 'pending' then
    raise exception 'BR-17: this approval has already been decided';
  end if;

  update public.approval
     set decision = p_decision,
         comment = p_comment,
         approver_id = auth.uid(),
         decided_at = now(),
         snapshot = coalesce(snapshot, '{}'::jsonb)
                    || jsonb_build_object('decided_by', auth.uid(), 'decided_at', now())
   where id = p_approval_id;

  perform set_config('app.audit_reason', p_comment, true);
end;
$$;

-- An approval decision is immutable once recorded.
create or replace function public.block_approval_edit()
returns trigger
language plpgsql
as $$
begin
  if old.decision <> 'pending' then
    if new.decision is distinct from old.decision
       or new.comment is distinct from old.comment
       or new.approver_id is distinct from old.approver_id then
      raise exception 'BR-17: an approval decision cannot be changed';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists approval_immutable on public.approval;
create trigger approval_immutable
  before update on public.approval
  for each row execute function public.block_approval_edit();

grant execute on function public.request_approval(text, uuid, text) to authenticated;
grant execute on function public.decide_approval(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Requirement enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'requirement_status') then
    create type public.requirement_status as enum (
      'received', 'qualifying', 'in_preparation', 'quoted', 'submitted',
      'won', 'partially_won', 'lost', 'not_pursued', 'cancelled', 'closed'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'requirement_type') then
    create type public.requirement_type as enum
      ('rfi', 'rfq', 'enquiry', 'tender', 'repeat', 'budgetary');
  end if;
  if not exists (select 1 from pg_type where typname = 'source_channel') then
    create type public.source_channel as enum
      ('gem', 'buyer_portal', 'email', 'direct', 'primary_client', 'oem', 'other');
  end if;
  if not exists (select 1 from pg_type where typname = 'bid_type') then
    create type public.bid_type as enum ('single', 'double', 'other');
  end if;
  if not exists (select 1 from pg_type where typname = 'submission_type') then
    create type public.submission_type as enum ('hard', 'soft', 'both');
  end if;
  if not exists (select 1 from pg_type where typname = 'line_status') then
    create type public.line_status as enum
      ('open', 'quoted', 'won', 'partially_won', 'lost', 'not_pursued', 'cancelled');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Requirement header
-- ---------------------------------------------------------------------------
create table if not exists public.requirement (
  id uuid primary key default gen_random_uuid(),
  internal_ref text unique not null,
  requirement_type public.requirement_type not null,
  customer_id uuid not null references public.customer (id) on delete restrict,
  division_id uuid references public.customer_division (id) on delete set null,
  location_id uuid references public.customer_location (id) on delete set null,
  primary_client_id uuid references public.customer (id) on delete set null,
  project_name text,
  source_channel public.source_channel not null,
  source_detail text,
  customer_reference text not null,
  portal_tender_no text,
  enquiry_date date not null,
  received_date date,
  submission_deadline timestamptz,
  deadline_tbc boolean not null default false,
  clarification_deadline timestamptz,
  quotation_validity_required_days integer,
  bid_type public.bid_type,
  submission_type public.submission_type,
  staggered_delivery boolean not null default false,
  required_delivery_summary text,
  payment_terms_requested text,
  approval_requirements_summary text,
  assigned_user_id uuid references public.profiles (id) on delete set null,
  status public.requirement_status not null default 'received',
  qualification_decision text,
  pass_reason text,
  regret_letter_document_id uuid,
  estimated_value numeric(14, 2) check (estimated_value is null or estimated_value >= 0),
  notes text,
  is_legacy_placeholder boolean not null default false,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint requirement_deadline_chk
    check (submission_deadline is null or submission_deadline::date >= enquiry_date)
);

create index if not exists requirement_customer_idx on public.requirement (customer_id);
create index if not exists requirement_status_idx on public.requirement (status);
create index if not exists requirement_assigned_idx on public.requirement (assigned_user_id);
create index if not exists requirement_deadline_idx on public.requirement (submission_deadline);

-- Assign the internal reference on insert when the caller did not supply one.
create or replace function public.set_requirement_ref()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.internal_ref is null or btrim(new.internal_ref) = '' then
    new.internal_ref := public.next_ref('RQ');
  end if;
  return new;
end;
$$;

drop trigger if exists requirement_set_ref on public.requirement;
create trigger requirement_set_ref
  before insert on public.requirement
  for each row execute function public.set_requirement_ref();

-- Direct status changes are blocked; only transition_requirement may change it.
create or replace function public.block_direct_status_change()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status
     and coalesce(current_setting('app.status_change_approved', true), '') <> 'on' then
    raise exception 'BR-30: status may only change through a controlled transition';
  end if;
  return new;
end;
$$;

drop trigger if exists requirement_block_direct_status on public.requirement;
create trigger requirement_block_direct_status
  before update on public.requirement
  for each row execute function public.block_direct_status_change();

-- Duplicate customer + reference warning (FR-RFI-01/03). Advisory, not a block.
create or replace function public.requirement_duplicate_customer_ref(
  p_customer_id uuid,
  p_customer_reference text,
  p_exclude_id uuid default null
)
returns table (id uuid, internal_ref text, status public.requirement_status, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.internal_ref, r.status, r.created_at
  from public.requirement r
  where r.customer_id = p_customer_id
    and lower(btrim(r.customer_reference)) = lower(btrim(p_customer_reference))
    and (p_exclude_id is null or r.id <> p_exclude_id)
  order by r.created_at desc
  limit 10;
$$;

grant execute on function public.requirement_duplicate_customer_ref(uuid, text, uuid) to authenticated;

-- Controlled transition (FR-RFI-07, BR-30).
create or replace function public.transition_requirement(
  p_id uuid,
  p_to_status public.requirement_status,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req public.requirement;
  v_requires boolean;
  v_approval uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.has_any_role(
    array['owner', 'sales', 'operations', 'admin']::public.app_role[]
  ) then
    raise exception 'FORBIDDEN: you may not change a requirement status';
  end if;

  select * into v_req from public.requirement where id = p_id for update;
  if not found then
    raise exception 'Requirement not found';
  end if;

  select t.requires_approval into v_requires
  from public.ref_status_transition t
  where t.entity = 'requirement'
    and t.from_status = v_req.status::text
    and t.to_status = p_to_status::text;

  if v_requires is null then
    raise exception 'BR-30: invalid status transition from % to %',
      v_req.status, p_to_status;
  end if;

  if p_to_status = 'not_pursued'
     and coalesce(public.setting_bool('pass_requires_owner'), true) then
    select a.id into v_approval
    from public.approval a
    where a.subject_type = 'requirement'
      and a.subject_id = p_id
      and a.decision = 'approved'
    order by a.decided_at desc
    limit 1;

    if v_approval is null then
      raise exception 'BR-14: Owner approval is required before passing a requirement';
    end if;
  end if;

  if p_to_status in ('not_pursued', 'lost', 'cancelled')
     and (p_reason is null or length(btrim(p_reason)) < 3) then
    raise exception 'A reason of at least 3 characters is required for this decision';
  end if;

  perform set_config('app.status_change_approved', 'on', true);

  update public.requirement
     set status = p_to_status,
         pass_reason = case when p_to_status = 'not_pursued' then p_reason else pass_reason end
   where id = p_id;

  insert into public.status_history
    (entity_type, entity_id, from_status, to_status, actor, reason, approval_id)
  values
    ('requirement', p_id, v_req.status::text, p_to_status::text, auth.uid(), p_reason, v_approval);
end;
$$;

grant execute on function public.transition_requirement(uuid, public.requirement_status, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Requirement lines (FR-RFI-02)
-- ---------------------------------------------------------------------------
create table if not exists public.requirement_line (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.requirement (id) on delete cascade,
  line_no integer not null check (line_no > 0),
  product_id uuid references public.product (id) on delete set null,
  customer_part_no text,
  oem_part_no text,
  internal_part_no text,
  part_no_norm text generated always as (
    lower(regexp_replace(
      btrim(coalesce(nullif(internal_part_no, ''), nullif(customer_part_no, ''), coalesce(oem_part_no, ''))),
      '\s+', ' ', 'g'
    ))
  ) stored,
  description text not null,
  specification_ref text,
  drawing_document_id uuid,
  drawing_revision text,
  quantity_required numeric(14, 3) not null check (quantity_required > 0),
  uom text not null,
  required_delivery_date date,
  required_delivery_period text,
  delivery_location_id uuid references public.customer_location (id) on delete set null,
  approval_types_required public.approval_type[] not null default '{}',
  line_notes text,
  line_status public.line_status not null default 'open',
  outcome text,
  loss_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requirement_id, line_no)
);

create index if not exists requirement_line_requirement_idx
  on public.requirement_line (requirement_id);
create index if not exists requirement_line_part_norm_idx
  on public.requirement_line (part_no_norm);

-- Enforce the configurable line limit (default 500) in the database.
create or replace function public.enforce_requirement_line_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max integer := coalesce(public.setting_num('max_lines', 500), 500)::integer;
  v_count integer;
begin
  select count(*) into v_count
  from public.requirement_line rl
  where rl.requirement_id = new.requirement_id
    and (tg_op <> 'UPDATE' or rl.id <> new.id);

  if v_count >= v_max then
    raise exception 'FR-RFI-02: maximum % lines per requirement', v_max;
  end if;
  return new;
end;
$$;

drop trigger if exists requirement_line_limit on public.requirement_line;
create trigger requirement_line_limit
  before insert on public.requirement_line
  for each row execute function public.enforce_requirement_line_limit();

-- ---------------------------------------------------------------------------
-- 8. Batch line upsert RPC (T2.3). One transaction, set-based, row-level errors.
-- ---------------------------------------------------------------------------
create or replace function public.upsert_requirement_lines(
  p_requirement_id uuid,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_ok integer := 0;
  v_line_no integer;
  v_qty numeric;
  v_uom text;
  v_desc text;
  v_id uuid;
  v_existing integer;
  v_max integer := coalesce(public.setting_num('max_lines', 500), 500)::integer;
  v_total integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.has_any_role(
    array['owner', 'sales', 'operations', 'admin']::public.app_role[]
  ) then
    raise exception 'FORBIDDEN: you may not edit requirement lines';
  end if;

  if not exists (select 1 from public.requirement where id = p_requirement_id) then
    raise exception 'Requirement not found';
  end if;

  if jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be a JSON array';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    begin
      v_line_no := (v_line ->> 'line_no')::integer;
      v_qty := (v_line ->> 'quantity_required')::numeric;
      v_uom := nullif(btrim(v_line ->> 'uom'), '');
      v_desc := nullif(btrim(v_line ->> 'description'), '');
      v_id := nullif(v_line ->> 'id', '')::uuid;

      if v_line_no is null or v_line_no <= 0 then
        raise exception 'Line number must be a positive whole number';
      end if;
      if v_desc is null then
        raise exception 'Description is required';
      end if;
      if v_qty is null or v_qty <= 0 then
        raise exception 'Quantity must be greater than zero';
      end if;
      if v_uom is null then
        raise exception 'UoM is required';
      end if;

      if v_id is null then
        select count(*) into v_existing
        from public.requirement_line
        where requirement_id = p_requirement_id;
        if not exists (
          select 1 from public.requirement_line
          where requirement_id = p_requirement_id and line_no = v_line_no
        ) and v_existing >= v_max then
          raise exception 'FR-RFI-02: maximum % lines per requirement', v_max;
        end if;

        insert into public.requirement_line (
          requirement_id, line_no, product_id, customer_part_no, oem_part_no,
          internal_part_no, description, specification_ref, drawing_document_id,
          drawing_revision, quantity_required, uom, required_delivery_date,
          required_delivery_period, delivery_location_id,
          approval_types_required, line_notes
        )
        values (
          p_requirement_id,
          v_line_no,
          nullif(v_line ->> 'product_id', '')::uuid,
          nullif(v_line ->> 'customer_part_no', ''),
          nullif(v_line ->> 'oem_part_no', ''),
          nullif(v_line ->> 'internal_part_no', ''),
          v_desc,
          nullif(v_line ->> 'specification_ref', ''),
          nullif(v_line ->> 'drawing_document_id', '')::uuid,
          nullif(v_line ->> 'drawing_revision', ''),
          v_qty,
          v_uom,
          nullif(v_line ->> 'required_delivery_date', '')::date,
          nullif(v_line ->> 'required_delivery_period', ''),
          nullif(v_line ->> 'delivery_location_id', '')::uuid,
          coalesce(
            (select array_agg(x)::public.approval_type[]
             from jsonb_array_elements_text(coalesce(v_line -> 'approval_types_required', '[]'::jsonb)) x),
            '{}'::public.approval_type[]
          ),
          nullif(v_line ->> 'line_notes', '')
        )
        on conflict (requirement_id, line_no) do update
          set product_id = excluded.product_id,
              customer_part_no = excluded.customer_part_no,
              oem_part_no = excluded.oem_part_no,
              internal_part_no = excluded.internal_part_no,
              description = excluded.description,
              specification_ref = excluded.specification_ref,
              drawing_document_id = excluded.drawing_document_id,
              drawing_revision = excluded.drawing_revision,
              quantity_required = excluded.quantity_required,
              uom = excluded.uom,
              required_delivery_date = excluded.required_delivery_date,
              required_delivery_period = excluded.required_delivery_period,
              delivery_location_id = excluded.delivery_location_id,
              approval_types_required = excluded.approval_types_required,
              line_notes = excluded.line_notes,
              updated_at = now();
      else
        update public.requirement_line
           set line_no = v_line_no,
               product_id = nullif(v_line ->> 'product_id', '')::uuid,
               customer_part_no = nullif(v_line ->> 'customer_part_no', ''),
               oem_part_no = nullif(v_line ->> 'oem_part_no', ''),
               internal_part_no = nullif(v_line ->> 'internal_part_no', ''),
               description = v_desc,
               specification_ref = nullif(v_line ->> 'specification_ref', ''),
               drawing_document_id = nullif(v_line ->> 'drawing_document_id', '')::uuid,
               drawing_revision = nullif(v_line ->> 'drawing_revision', ''),
               quantity_required = v_qty,
               uom = v_uom,
               required_delivery_date = nullif(v_line ->> 'required_delivery_date', '')::date,
               required_delivery_period = nullif(v_line ->> 'required_delivery_period', ''),
               delivery_location_id = nullif(v_line ->> 'delivery_location_id', '')::uuid,
               approval_types_required = coalesce(
                 (select array_agg(x)::public.approval_type[]
                  from jsonb_array_elements_text(coalesce(v_line -> 'approval_types_required', '[]'::jsonb)) x),
                 '{}'::public.approval_type[]
               ),
               line_notes = nullif(v_line ->> 'line_notes', ''),
               updated_at = now()
         where id = v_id and requirement_id = p_requirement_id;

        if not found then
          raise exception 'Line not found on this requirement';
        end if;
      end if;

      v_ok := v_ok + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_object(
        'line_no', coalesce(v_line_no, (v_line ->> 'line_no')::integer),
        'error', sqlerrm
      );
    end;
  end loop;

  select count(*) into v_total
  from public.requirement_line
  where requirement_id = p_requirement_id;

  return jsonb_build_object(
    'saved', v_ok,
    'total', v_total,
    'errors', v_errors
  );
end;
$$;

grant execute on function public.upsert_requirement_lines(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Triggers: audit, updated_at, row_version
-- ---------------------------------------------------------------------------
-- Stamp created_by/updated_by from the session when the caller did not set it.
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
  v_has_updated boolean;
  v_has_version boolean;
  v_has_created boolean;
begin
  foreach t in array array[
    'app_setting', 'approval', 'requirement', 'requirement_line'
  ] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format(
      'create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()',
      t, t);

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'updated_at'
    ) into v_has_updated;
    if v_has_updated then
      execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
      execute format(
        'create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()',
        t, t);
    end if;

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'row_version'
    ) into v_has_version;
    if v_has_version then
      execute format('drop trigger if exists %I_row_version on public.%I', t, t);
      execute format(
        'create trigger %I_row_version before update on public.%I for each row execute function public.bump_row_version()',
        t, t);
    end if;

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'created_by'
    ) into v_has_created;
    if v_has_created then
      execute format('drop trigger if exists %I_stamp_actor on public.%I', t, t);
      execute format(
        'create trigger %I_stamp_actor before insert or update on public.%I for each row execute function public.stamp_actor()',
        t, t);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 10. Row Level Security
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  v_write text := 'public.has_any_role(array[''owner'',''sales'',''operations'',''admin'']::public.app_role[])';
begin
  foreach t in array array['requirement', 'requirement_line'] loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (true)',
      t, t);

    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (%s)',
      t, t, v_write);

    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (%s) with check (%s)',
      t, t, v_write, v_write);

    execute format('drop policy if exists %I_delete on public.%I', t, t);
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated using (%s)',
      t, t, v_write);
  end loop;
end
$$;

-- status_history needs an explicit SELECT-friendly grant only; writes are
-- SECURITY DEFINER. approval has its own policy defined above.

-- ---------------------------------------------------------------------------
-- 11. Grants
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.requirement to authenticated;
grant select, insert, update, delete on public.requirement_line to authenticated;
grant select on public.approval to authenticated;
grant select on public.status_history to authenticated;
grant select on public.app_setting to authenticated;
grant select on public.ref_status_transition to authenticated;
