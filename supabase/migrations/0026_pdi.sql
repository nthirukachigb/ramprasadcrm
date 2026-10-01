-- Defence Contract CRM — Phase 8: PDI call and quantified inspection (T8.2)
-- Offered = cleared + rejected + held (TECH-STACK §10.1, FR-PDI-02).
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
