-- Defence Contract CRM — Phase 8: PO line balance, dispatch gate and override (T8.3)
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
