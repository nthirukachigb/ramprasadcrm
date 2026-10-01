-- Defence Contract CRM — Phase 8: Milestones, readiness, serials, subcontract (T8.1)
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
