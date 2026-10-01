-- ===========================================================================
-- Defence Contract CRM - Phase 8 (Readiness, PDI, dispatch, delivery, risk)
-- ---------------------------------------------------------------------------
-- Run APPLY_MANUALLY_PHASE7.sql first, then paste this file into the Supabase
-- SQL Editor and run it. Idempotent (safe to re-run).
--   0025_fulfilment.sql 0026_pdi.sql 0027_dispatch.sql
--   0028_delivery.sql 0029_risk.sql
-- ===========================================================================

-- >>> supabase/migrations/0025_fulfilment.sql
-- Defence Contract CRM â€” Phase 8: Milestones, readiness, serials, subcontract (T8.1)
-- Fulfilment visibility (not a manufacturing ERP). Milestones seed from a
-- template when a customer PO is created; readiness is capped at the ordered
-- quantity.
-- Idempotent. Depends on 0020_customer_po.sql.

-- ---------------------------------------------------------------------------
-- 1. Milestone template + milestones
-- ---------------------------------------------------------------------------
create table if not exists public.milestone_template (
  milestone_key text primary key,
  name text not null,
  sort_order integer not null default 0,
  default_offset_days integer not null default 0
);

insert into public.milestone_template (milestone_key, name, sort_order, default_offset_days)
values
  ('order_review', 'Order review', 10, 2),
  ('material_planning', 'Material planning', 20, 5),
  ('procurement', 'Procurement / OEM PO', 30, 10),
  ('manufacturing', 'Manufacturing / assembly', 40, 30),
  ('readiness', 'Material readiness', 50, 45),
  ('pdi', 'PDI', 60, 50),
  ('dispatch', 'Dispatch', 70, 55)
on conflict (milestone_key) do nothing;

alter table public.milestone_template enable row level security;
drop policy if exists milestone_template_select on public.milestone_template;
create policy milestone_template_select on public.milestone_template
  for select to authenticated using (true);
drop policy if exists milestone_template_admin on public.milestone_template;
create policy milestone_template_admin on public.milestone_template
  for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

create table if not exists public.fulfilment_milestone (
  id uuid primary key default gen_random_uuid(),
  customer_po_id uuid not null references public.customer_po (id) on delete cascade,
  po_line_id uuid references public.po_line (id) on delete cascade,
  milestone_key text not null references public.milestone_template (milestone_key),
  name text not null,
  owner_user_id uuid references public.profiles (id) on delete set null,
  expected_date date,
  actual_date date,
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'done', 'overdue', 'cancelled')),
  sort_order integer not null default 0,
  notes text,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint milestone_actual_chk check (actual_date is null or actual_date <= current_date)
);

create index if not exists fulfilment_milestone_po_idx
  on public.fulfilment_milestone (customer_po_id);

-- Seed milestones when a customer PO is created.
create or replace function public.seed_po_milestones()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.fulfilment_milestone
    (customer_po_id, milestone_key, name, expected_date, sort_order)
  select
    new.id,
    mt.milestone_key,
    mt.name,
    coalesce(new.po_date, current_date) + mt.default_offset_days,
    mt.sort_order
  from public.milestone_template mt
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists customer_po_seed_milestones on public.customer_po;
create trigger customer_po_seed_milestones
  after insert on public.customer_po
  for each row execute function public.seed_po_milestones();

-- ---------------------------------------------------------------------------
-- 2. Material readiness
-- ---------------------------------------------------------------------------
create table if not exists public.material_readiness (
  id uuid primary key default gen_random_uuid(),
  customer_po_id uuid not null references public.customer_po (id) on delete cascade,
  po_line_id uuid not null references public.po_line (id) on delete cascade,
  ready_qty numeric(14, 3) not null check (ready_qty >= 0),
  checked_at timestamptz not null default now(),
  checked_by uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists material_readiness_po_idx on public.material_readiness (customer_po_id);
create index if not exists material_readiness_line_idx on public.material_readiness (po_line_id);

-- Ready quantity cannot exceed the ordered quantity (US-09).
create or replace function public.check_readiness_qty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_effective numeric;
begin
  select qty_ordered_effective into v_effective
  from public.po_line where id = new.po_line_id;
  if v_effective is null then
    raise exception 'Readiness must reference a customer PO line';
  end if;
  if new.ready_qty > v_effective then
    raise exception 'US-09: ready quantity % exceeds the ordered quantity %',
      new.ready_qty, v_effective;
  end if;
  return new;
end;
$$;

drop trigger if exists material_readiness_qty on public.material_readiness;
create trigger material_readiness_qty
  before insert or update on public.material_readiness
  for each row execute function public.check_readiness_qty();

-- ---------------------------------------------------------------------------
-- 3. Serial numbers
-- ---------------------------------------------------------------------------
create table if not exists public.serial_number (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.product (id) on delete cascade,
  po_line_id uuid references public.po_line (id) on delete set null,
  serial text not null,
  status text not null default 'available'
    check (status in ('available', 'dispatched', 'delivered', 'rejected', 'scrapped')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, serial)
);

create index if not exists serial_number_line_idx on public.serial_number (po_line_id);

-- ---------------------------------------------------------------------------
-- 4. Subcontract work package (basic)
-- ---------------------------------------------------------------------------
create table if not exists public.subcontract_work_package (
  id uuid primary key default gen_random_uuid(),
  customer_po_id uuid not null references public.customer_po (id) on delete cascade,
  partner_id uuid references public.partner (id) on delete set null,
  scope text not null,
  value numeric(14, 2) check (value is null or value >= 0),
  status text not null default 'planned'
    check (status in ('planned', 'sent', 'in_progress', 'completed', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subcontract_po_idx on public.subcontract_work_package (customer_po_id);

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
  v_has_version boolean;
  v_has_created boolean;
begin
  foreach t in array array[
    'fulfilment_milestone', 'material_readiness', 'serial_number', 'subcontract_work_package'
  ] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t, t);
    execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);

    select exists (select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='row_version') into v_has_version;
    if v_has_version then
      execute format('drop trigger if exists %I_row_version on public.%I', t, t);
      execute format('create trigger %I_row_version before update on public.%I for each row execute function public.bump_row_version()', t, t);
    end if;

    select exists (select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='created_by') into v_has_created;
    if v_has_created then
      execute format('drop trigger if exists %I_stamp_actor on public.%I', t, t);
      execute format('create trigger %I_stamp_actor before insert or update on public.%I for each row execute function public.stamp_actor()', t, t);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Row Level Security and grants
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  v_write text := 'public.has_any_role(array[''owner'',''sales'',''operations'',''admin'']::public.app_role[])';
begin
  foreach t in array array[
    'fulfilment_milestone', 'material_readiness', 'serial_number', 'subcontract_work_package'
  ] loop
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

grant select, insert, update, delete on public.fulfilment_milestone to authenticated;
grant select, insert, update, delete on public.material_readiness to authenticated;
grant select, insert, update, delete on public.serial_number to authenticated;
grant select, insert, update, delete on public.subcontract_work_package to authenticated;
grant select on public.milestone_template to authenticated;

-- >>> supabase/migrations/0026_pdi.sql
-- Defence Contract CRM â€” Phase 8: PDI call and quantified inspection (T8.2)
-- Offered = cleared + rejected + held (TECH-STACK Â§10.1, FR-PDI-02).
-- Idempotent. Depends on 0025_fulfilment.sql.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'pdi_status') then
    create type public.pdi_status as enum
      ('called', 'in_progress', 'cleared', 'partially_cleared', 'held', 'cancelled');
  end if;
end
$$;

create table if not exists public.pdi (
  id uuid primary key default gen_random_uuid(),
  customer_po_id uuid not null references public.customer_po (id) on delete cascade,
  parent_pdi_id uuid references public.pdi (id) on delete set null,
  status public.pdi_status not null default 'called',
  called_date date not null default current_date,
  completed_date date,
  notes text,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pdi_po_idx on public.pdi (customer_po_id);

create table if not exists public.pdi_line (
  id uuid primary key default gen_random_uuid(),
  pdi_id uuid not null references public.pdi (id) on delete cascade,
  po_line_id uuid not null references public.po_line (id) on delete cascade,
  qty_offered numeric(14, 3) not null check (qty_offered > 0),
  qty_cleared numeric(14, 3) not null default 0 check (qty_cleared >= 0),
  qty_rejected numeric(14, 3) not null default 0 check (qty_rejected >= 0),
  qty_held numeric(14, 3) not null default 0 check (qty_held >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pdi_id, po_line_id),
  constraint pdi_line_sum_chk
    check (qty_cleared + qty_rejected + qty_held = qty_offered)
);

create index if not exists pdi_line_pdi_idx on public.pdi_line (pdi_id);
create index if not exists pdi_line_po_line_idx on public.pdi_line (po_line_id);

-- A PDI call cannot exceed the ready quantity; a re-inspection is capped at the
-- rejected + held quantity of its parent call.
create or replace function public.check_pdi_offer_qty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ready numeric;
  v_effective numeric;
  v_parent uuid;
  v_reofferable numeric;
begin
  select qty_ordered_effective into v_effective from public.po_line where id = new.po_line_id;
  select coalesce(sum(ready_qty), 0) into v_ready
  from public.material_readiness where po_line_id = new.po_line_id;
  if v_ready = 0 then
    v_ready := v_effective;
  end if;

  select parent_pdi_id into v_parent from public.pdi where id = new.pdi_id;
  if v_parent is not null then
    select coalesce(sum(qty_rejected + qty_held), 0) into v_reofferable
    from public.pdi_line pl
    join public.pdi p on p.id = pl.pdi_id
    where p.id = v_parent and pl.po_line_id = new.po_line_id;
    if new.qty_offered > v_reofferable then
      raise exception
        'FR-PDI-04: a re-inspection of % exceeds the rejected + held quantity %',
        new.qty_offered, v_reofferable;
    end if;
  elsif new.qty_offered > v_ready then
    raise exception 'FR-PDI-02: offered quantity % exceeds the ready quantity %',
      new.qty_offered, v_ready;
  end if;
  return new;
end;
$$;

drop trigger if exists pdi_line_offer_qty on public.pdi_line;
create trigger pdi_line_offer_qty
  before insert or update on public.pdi_line
  for each row execute function public.check_pdi_offer_qty();

-- ---------------------------------------------------------------------------
-- PDI summary per PO line
-- ---------------------------------------------------------------------------
create or replace view public.v_pdi_summary
with (security_invoker = true) as
select
  pl.po_line_id                       as po_line_id,
  pl.customer_po_id                   as customer_po_id,
  coalesce(sum(pl.qty_offered), 0)    as qty_offered,
  coalesce(sum(pl.qty_cleared), 0)    as qty_cleared,
  coalesce(sum(pl.qty_rejected), 0)   as qty_rejected,
  coalesce(sum(pl.qty_held), 0)       as qty_held,
  coalesce(sum(pl.qty_rejected + pl.qty_held), 0) as qty_reofferable
from (
  select l.po_line_id, p.customer_po_id, l.qty_offered, l.qty_cleared, l.qty_rejected, l.qty_held
  from public.pdi_line l join public.pdi p on p.id = l.pdi_id
) pl
group by pl.po_line_id, pl.customer_po_id;

grant select on public.v_pdi_summary to authenticated;

-- ---------------------------------------------------------------------------
-- Audit, updated_at, row_version and RLS
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
  v_has_version boolean;
  v_has_created boolean;
begin
  foreach t in array array['pdi', 'pdi_line'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t, t);
    execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);

    select exists (select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='row_version') into v_has_version;
    if v_has_version then
      execute format('drop trigger if exists %I_row_version on public.%I', t, t);
      execute format('create trigger %I_row_version before update on public.%I for each row execute function public.bump_row_version()', t, t);
    end if;

    select exists (select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='created_by') into v_has_created;
    if v_has_created then
      execute format('drop trigger if exists %I_stamp_actor on public.%I', t, t);
      execute format('create trigger %I_stamp_actor before insert or update on public.%I for each row execute function public.stamp_actor()', t, t);
    end if;
  end loop;
end
$$;

do $$
declare
  t text;
  v_write text := 'public.has_any_role(array[''owner'',''sales'',''operations'',''admin'']::public.app_role[])';
begin
  foreach t in array array['pdi', 'pdi_line'] loop
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

grant select, insert, update, delete on public.pdi to authenticated;
grant select, insert, update, delete on public.pdi_line to authenticated;

-- >>> supabase/migrations/0027_dispatch.sql
-- Defence Contract CRM â€” Phase 8: PO line balance, dispatch gate and override (T8.3)
-- Held or rejected quantity cannot be dispatched without an approved override
-- (FR-PDI-03, BR-13). Delivered/accepted/invoiced branches are 0 until later
-- phases replace this view.
-- Idempotent. Depends on 0026_pdi.sql.

-- ---------------------------------------------------------------------------
-- Dispatch
-- ---------------------------------------------------------------------------
create table if not exists public.dispatch (
  id uuid primary key default gen_random_uuid(),
  internal_ref text unique,
  customer_po_id uuid not null references public.customer_po (id) on delete cascade,
  dispatch_date date not null default current_date,
  mode text,
  lr_awb text,
  eway_bill text,
  location_id uuid references public.customer_location (id) on delete set null,
  notes text,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dispatch_po_idx on public.dispatch (customer_po_id);

create or replace function public.set_dispatch_ref()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.internal_ref is null or btrim(new.internal_ref) = '' then
    new.internal_ref := public.next_ref('DSP');
  end if;
  return new;
end;
$$;

drop trigger if exists dispatch_set_ref on public.dispatch;
create trigger dispatch_set_ref
  before insert on public.dispatch
  for each row execute function public.set_dispatch_ref();

create table if not exists public.dispatch_override (
  id uuid primary key default gen_random_uuid(),
  po_line_id uuid not null references public.po_line (id) on delete cascade,
  qty numeric(14, 3) not null check (qty > 0),
  reason text,
  status text not null default 'requested'
    check (status in ('requested', 'approved', 'rejected', 'consumed')),
  approval_id uuid references public.approval (id) on delete set null,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dispatch_override_line_idx on public.dispatch_override (po_line_id);

create table if not exists public.dispatch_line (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references public.dispatch (id) on delete cascade,
  po_line_id uuid not null references public.po_line (id) on delete cascade,
  qty numeric(14, 3) not null check (qty > 0),
  override_id uuid references public.dispatch_override (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dispatch_id, po_line_id)
);

create index if not exists dispatch_line_dispatch_idx on public.dispatch_line (dispatch_id);
create index if not exists dispatch_line_po_line_idx on public.dispatch_line (po_line_id);

-- ---------------------------------------------------------------------------
-- Dispatch gate
-- ---------------------------------------------------------------------------
-- v_po_line_balance is defined (and later extended) in 0028_delivery.sql.
-- The gate below reads it at runtime.

-- The gate: only PDI-cleared quantity (plus an approved override) is dispatchable.
create or replace function public.dispatch_line_pdi_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispatchable numeric;
begin
  -- Serialise concurrent dispatches on the same PO line.
  perform 1 from public.po_line where id = new.po_line_id for update;

  select qty_dispatchable into v_dispatchable
  from public.v_po_line_balance where po_line_id = new.po_line_id;

  if v_dispatchable is null then
    raise exception 'BR-13: dispatch line references an unknown PO line';
  end if;
  if new.qty > v_dispatchable then
    raise exception
      'BR-13: dispatch quantity % exceeds the PDI-cleared available %',
      new.qty, v_dispatchable;
  end if;
  return new;
end;
$$;

drop trigger if exists dispatch_line_pdi_gate_trg on public.dispatch_line;
create trigger dispatch_line_pdi_gate_trg
  before insert or update on public.dispatch_line
  for each row execute function public.dispatch_line_pdi_gate();

-- Request an override (approval via the framework).
create or replace function public.request_dispatch_override(
  p_po_line_id uuid,
  p_qty numeric,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_approval uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.has_any_role(
    array['owner', 'sales', 'operations', 'admin']::public.app_role[]
  ) then
    raise exception 'FORBIDDEN: you may not request a dispatch override';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'The override quantity must be greater than zero';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'A reason of at least 3 characters is required';
  end if;

  insert into public.dispatch_override (po_line_id, qty, reason, status)
  values (p_po_line_id, p_qty, p_reason, 'requested')
  returning id into v_id;

  v_approval := public.request_approval('dispatch_override', v_id, p_reason);
  update public.dispatch_override set approval_id = v_approval where id = v_id;
  return v_id;
end;
$$;

grant execute on function public.request_dispatch_override(uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Audit, updated_at, row_version and RLS
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
  v_has_version boolean;
  v_has_created boolean;
begin
  foreach t in array array['dispatch', 'dispatch_line', 'dispatch_override'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t, t);
    execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);

    select exists (select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='row_version') into v_has_version;
    if v_has_version then
      execute format('drop trigger if exists %I_row_version on public.%I', t, t);
      execute format('create trigger %I_row_version before update on public.%I for each row execute function public.bump_row_version()', t, t);
    end if;

    select exists (select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='created_by') into v_has_created;
    if v_has_created then
      execute format('drop trigger if exists %I_stamp_actor on public.%I', t, t);
      execute format('create trigger %I_stamp_actor before insert or update on public.%I for each row execute function public.stamp_actor()', t, t);
    end if;
  end loop;
end
$$;

do $$
declare
  t text;
  v_write text := 'public.has_any_role(array[''owner'',''sales'',''operations'',''admin'']::public.app_role[])';
begin
  foreach t in array array['dispatch', 'dispatch_line', 'dispatch_override'] loop
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

grant select, insert, update, delete on public.dispatch to authenticated;
grant select, insert, update, delete on public.dispatch_line to authenticated;
grant select, insert, update on public.dispatch_override to authenticated;

-- >>> supabase/migrations/0028_delivery.sql
-- Defence Contract CRM â€” Phase 8: Delivery, acceptance and closure (T8.5)
-- The outstanding balance stays right: outstanding = ordered âˆ’ net accepted,
-- where net accepted = accepted âˆ’ rejected (a rejection raises outstanding).
-- Replaces v_po_line_balance to include delivered and accepted.
-- Idempotent. Depends on 0027_dispatch.sql.

alter table public.po_line
  add column if not exists delivery_closed boolean not null default false;
alter table public.po_line
  add column if not exists financial_closed boolean not null default false;

alter table public.po_delivery_schedule
  add column if not exists forecast_date date;

-- ---------------------------------------------------------------------------
-- 1. delivery
-- ---------------------------------------------------------------------------
create table if not exists public.delivery (
  id uuid primary key default gen_random_uuid(),
  internal_ref text unique,
  customer_po_id uuid not null references public.customer_po (id) on delete cascade,
  dispatch_id uuid references public.dispatch (id) on delete set null,
  delivery_date date not null default current_date,
  grn_number text,
  pod_document_id uuid references public.document (id) on delete set null,
  mode text,
  status text not null default 'in_transit'
    check (status in ('in_transit', 'delivered', 'closed', 'cancelled')),
  notes text,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists delivery_po_idx on public.delivery (customer_po_id);

create or replace function public.set_delivery_ref()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.internal_ref is null or btrim(new.internal_ref) = '' then
    new.internal_ref := public.next_ref('DEL');
  end if;
  return new;
end;
$$;

drop trigger if exists delivery_set_ref on public.delivery;
create trigger delivery_set_ref
  before insert on public.delivery
  for each row execute function public.set_delivery_ref();

create table if not exists public.delivery_line (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.delivery (id) on delete cascade,
  po_line_id uuid not null references public.po_line (id) on delete cascade,
  qty numeric(14, 3) not null check (qty > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (delivery_id, po_line_id)
);

create index if not exists delivery_line_line_idx on public.delivery_line (po_line_id);

-- Delivered quantity cannot exceed dispatched quantity (BR-07).
create or replace function public.check_delivery_line_qty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispatched numeric;
  v_delivered numeric;
begin
  select coalesce(sum(qty), 0) into v_dispatched
  from public.dispatch_line where po_line_id = new.po_line_id;
  select coalesce(sum(qty), 0) into v_delivered
  from public.delivery_line
  where po_line_id = new.po_line_id and (tg_op <> 'UPDATE' or id <> new.id);

  if v_delivered + new.qty > v_dispatched then
    raise exception 'BR-07: delivered quantity % exceeds dispatched %',
      v_delivered + new.qty, v_dispatched;
  end if;
  return new;
end;
$$;

drop trigger if exists delivery_line_qty on public.delivery_line;
create trigger delivery_line_qty
  before insert or update on public.delivery_line
  for each row execute function public.check_delivery_line_qty();

-- ---------------------------------------------------------------------------
-- 2. acceptance
-- ---------------------------------------------------------------------------
create table if not exists public.acceptance (
  id uuid primary key default gen_random_uuid(),
  internal_ref text unique,
  customer_po_id uuid not null references public.customer_po (id) on delete cascade,
  delivery_id uuid references public.delivery (id) on delete set null,
  acceptance_date date not null default current_date,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'partially_accepted', 'rejected')),
  notes text,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists acceptance_po_idx on public.acceptance (customer_po_id);

create or replace function public.set_acceptance_ref()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.internal_ref is null or btrim(new.internal_ref) = '' then
    new.internal_ref := public.next_ref('ACC');
  end if;
  return new;
end;
$$;

drop trigger if exists acceptance_set_ref on public.acceptance;
create trigger acceptance_set_ref
  before insert on public.acceptance
  for each row execute function public.set_acceptance_ref();

create table if not exists public.acceptance_line (
  id uuid primary key default gen_random_uuid(),
  acceptance_id uuid not null references public.acceptance (id) on delete cascade,
  po_line_id uuid not null references public.po_line (id) on delete cascade,
  qty_accepted numeric(14, 3) not null default 0 check (qty_accepted >= 0),
  qty_rejected numeric(14, 3) not null default 0 check (qty_rejected >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (acceptance_id, po_line_id),
  constraint acceptance_line_balance_chk check (qty_accepted + qty_rejected > 0)
);

create index if not exists acceptance_line_line_idx on public.acceptance_line (po_line_id);

-- Dispositioned quantity cannot exceed the delivered quantity.
create or replace function public.check_acceptance_line_qty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivered numeric;
  v_other numeric;
begin
  select coalesce(sum(qty), 0) into v_delivered
  from public.delivery_line where po_line_id = new.po_line_id;
  select coalesce(sum(qty_accepted + qty_rejected), 0) into v_other
  from public.acceptance_line
  where po_line_id = new.po_line_id and (tg_op <> 'UPDATE' or id <> new.id);

  if v_other + new.qty_accepted + new.qty_rejected > v_delivered then
    raise exception 'BR-09: accepted + rejected % exceeds the delivered %',
      v_other + new.qty_accepted + new.qty_rejected, v_delivered;
  end if;
  return new;
end;
$$;

drop trigger if exists acceptance_line_qty on public.acceptance_line;
create trigger acceptance_line_qty
  before insert or update on public.acceptance_line
  for each row execute function public.check_acceptance_line_qty();

-- ---------------------------------------------------------------------------
-- 3. Closure flags and a replacement task on rejection
-- ---------------------------------------------------------------------------
create or replace function public.refresh_po_line_closure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line uuid := coalesce(new.po_line_id, old.po_line_id);
  v_ordered numeric;
  v_dispositioned numeric;
begin
  select qty_ordered_effective into v_ordered from public.po_line where id = v_line;
  if v_ordered is null then
    return null;
  end if;

  select coalesce(sum(qty_accepted + qty_rejected), 0) into v_dispositioned
  from public.acceptance_line where po_line_id = v_line;

  update public.po_line
     set delivery_closed = (v_dispositioned >= v_ordered)
   where id = v_line;

  -- A rejection needs a replacement follow-up.
  if coalesce(new.qty_rejected, 0) > 0 then
    perform public.ensure_task(
      'delivery_rejected', 'po_line', v_line,
      'Rejected quantity â€” arrange replacement',
      null, current_date + 2, 'high');
  end if;
  return null;
end;
$$;

drop trigger if exists acceptance_line_closure on public.acceptance_line;
create trigger acceptance_line_closure
  after insert or update on public.acceptance_line
  for each row execute function public.refresh_po_line_closure();

insert into public.task_rule (rule_id, name, description, enabled)
values ('delivery_rejected', 'Rejected quantity', 'A delivery/acceptance rejection needs a replacement.', true)
on conflict (rule_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Replace v_po_line_balance to include delivered and accepted
-- ---------------------------------------------------------------------------
create or replace view public.v_po_line_balance
with (security_invoker = true) as
with pdi as (
  select po_line_id, sum(qty_cleared) as cleared, sum(qty_rejected) as rejected
  from public.pdi_line group by po_line_id
),
disp as (
  select po_line_id, sum(qty) as dispatched
  from public.dispatch_line group by po_line_id
),
ovr as (
  select po_line_id, sum(qty) as approved_override
  from public.dispatch_override where status = 'approved' group by po_line_id
),
del as (
  select po_line_id, sum(qty) as delivered
  from public.delivery_line group by po_line_id
),
acc as (
  select po_line_id, sum(qty_accepted) as accepted, sum(qty_rejected) as rejected
  from public.acceptance_line group by po_line_id
)
select
  pl.id                                   as po_line_id,
  pl.customer_po_id                       as customer_po_id,
  pl.qty_ordered_effective                as qty_ordered,
  coalesce(pdi.cleared, 0)                as qty_cleared,
  coalesce(pdi.rejected, 0)               as qty_rejected,
  coalesce(disp.dispatched, 0)            as qty_dispatched,
  coalesce(del.delivered, 0)              as qty_delivered,
  greatest(0, coalesce(acc.accepted, 0) - coalesce(acc.rejected, 0)) as qty_accepted,
  0::numeric                              as qty_invoiced,
  greatest(
    0,
    coalesce(pdi.cleared, 0) + coalesce(ovr.approved_override, 0) - coalesce(disp.dispatched, 0)
  )                                       as qty_dispatchable,
  greatest(
    0,
    pl.qty_ordered_effective
      - greatest(0, coalesce(acc.accepted, 0) - coalesce(acc.rejected, 0))
  )                                       as qty_outstanding
from public.po_line pl
left join pdi on pdi.po_line_id = pl.id
left join disp on disp.po_line_id = pl.id
left join ovr on ovr.po_line_id = pl.id
left join del on del.po_line_id = pl.id
left join acc on acc.po_line_id = pl.id;

grant select on public.v_po_line_balance to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Audit, updated_at, row_version and RLS
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
  v_has_version boolean;
  v_has_created boolean;
begin
  foreach t in array array['delivery', 'delivery_line', 'acceptance', 'acceptance_line'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t, t);
    execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);

    select exists (select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='row_version') into v_has_version;
    if v_has_version then
      execute format('drop trigger if exists %I_row_version on public.%I', t, t);
      execute format('create trigger %I_row_version before update on public.%I for each row execute function public.bump_row_version()', t, t);
    end if;

    select exists (select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='created_by') into v_has_created;
    if v_has_created then
      execute format('drop trigger if exists %I_stamp_actor on public.%I', t, t);
      execute format('create trigger %I_stamp_actor before insert or update on public.%I for each row execute function public.stamp_actor()', t, t);
    end if;
  end loop;
end
$$;

do $$
declare
  t text;
  v_write text := 'public.has_any_role(array[''owner'',''sales'',''operations'',''admin'']::public.app_role[])';
begin
  foreach t in array array['delivery', 'delivery_line', 'acceptance', 'acceptance_line'] loop
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

grant select, insert, update, delete on public.delivery to authenticated;
grant select, insert, update, delete on public.delivery_line to authenticated;
grant select, insert, update, delete on public.acceptance to authenticated;
grant select, insert, update, delete on public.acceptance_line to authenticated;

-- >>> supabase/migrations/0029_risk.sql
-- Defence Contract CRM â€” Phase 8: Delivery risk, extensions, jobs and tiles (T8.6)
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

-- Ask PostgREST to pick up the new functions and views immediately.
notify pgrst, 'reload schema';
