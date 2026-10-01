-- Defence Contract CRM — Phase 8: Delivery, acceptance and closure (T8.5)
-- The outstanding balance stays right: outstanding = ordered − net accepted,
-- where net accepted = accepted − rejected (a rejection raises outstanding).
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
      'Rejected quantity — arrange replacement',
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
