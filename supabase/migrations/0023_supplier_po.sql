-- Defence Contract CRM — Phase 7: Supplier PO and PO-level coverage (T7.5)
-- The buying side, linked to customer PO lines. A partner other than the
-- approved OEM selection needs an owner approval. Every supplier PO line
-- resolves to exactly one requirement line (FR-SPO-01).
-- Idempotent. Depends on 0022_po_amendment.sql.

create table if not exists public.supplier_po (
  id uuid primary key default gen_random_uuid(),
  internal_ref text unique,
  customer_po_id uuid not null references public.customer_po (id) on delete cascade,
  partner_id uuid not null references public.partner (id),
  po_date date not null default current_date,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'acknowledged', 'completed', 'cancelled')),
  approval_id uuid references public.approval (id) on delete set null,
  notes text,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists supplier_po_customer_po_idx on public.supplier_po (customer_po_id);

create or replace function public.set_supplier_po_ref()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.internal_ref is null or btrim(new.internal_ref) = '' then
    new.internal_ref := public.next_ref('SPO');
  end if;
  return new;
end;
$$;

drop trigger if exists supplier_po_set_ref on public.supplier_po;
create trigger supplier_po_set_ref
  before insert on public.supplier_po
  for each row execute function public.set_supplier_po_ref();

create table if not exists public.supplier_po_line (
  id uuid primary key default gen_random_uuid(),
  supplier_po_id uuid not null references public.supplier_po (id) on delete cascade,
  po_line_id uuid not null references public.po_line (id),
  requirement_line_id uuid not null references public.requirement_line (id),
  commitment_id uuid references public.quantity_commitment (id) on delete set null,
  qty numeric(14, 3) not null check (qty > 0),
  unit_cost numeric(14, 4) check (unit_cost is null or unit_cost >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (supplier_po_id, po_line_id)
);

create index if not exists supplier_po_line_spo_idx on public.supplier_po_line (supplier_po_id);
create index if not exists supplier_po_line_po_line_idx on public.supplier_po_line (po_line_id);

-- Derive the requirement line and enforce the approved-selection rule.
create or replace function public.check_supplier_po_line()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req_line uuid;
  v_partner uuid;
  v_approval uuid;
  v_approved boolean;
begin
  select requirement_line_id into v_req_line from public.po_line where id = new.po_line_id;
  if v_req_line is null then
    raise exception 'FR-SPO-01: the supplier PO line must reference a customer PO line';
  end if;
  new.requirement_line_id := v_req_line;

  select partner_id, approval_id into v_partner, v_approval
  from public.supplier_po where id = new.supplier_po_id;

  select exists (
    select 1 from public.oem_selection s
    where s.requirement_line_id = v_req_line
      and s.partner_id = v_partner
      and s.status = 'approved'
  ) into v_approved;

  if not v_approved then
    if v_approval is null
       or not exists (
         select 1 from public.approval a
         where a.id = v_approval and a.decision = 'approved'
       ) then
      raise exception
        'FR-SPO-01: partner is not the approved OEM selection; an owner approval is required';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists supplier_po_line_check on public.supplier_po_line;
create trigger supplier_po_line_check
  before insert or update on public.supplier_po_line
  for each row execute function public.check_supplier_po_line();

-- ---------------------------------------------------------------------------
-- PO-level coverage
-- ---------------------------------------------------------------------------
create or replace view public.v_po_line_coverage
with (security_invoker = true) as
select
  pl.id                              as po_line_id,
  pl.customer_po_id                  as customer_po_id,
  pl.requirement_line_id             as requirement_line_id,
  pl.qty_ordered_effective           as qty_ordered,
  coalesce(sum(spl.qty), 0)          as qty_covered,
  greatest(0, pl.qty_ordered_effective - coalesce(sum(spl.qty), 0)) as qty_uncovered
from public.po_line pl
left join public.supplier_po_line spl on spl.po_line_id = pl.id
group by pl.id, pl.customer_po_id, pl.requirement_line_id, pl.qty_ordered_effective;

grant select on public.v_po_line_coverage to authenticated;

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
  v_has_created boolean;
begin
  foreach t in array array['supplier_po', 'supplier_po_line'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t, t);
    execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);

    select exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='row_version'
    ) into v_has_created;
    if v_has_created then
      execute format('drop trigger if exists %I_row_version on public.%I', t, t);
      execute format('create trigger %I_row_version before update on public.%I for each row execute function public.bump_row_version()', t, t);
    end if;

    select exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name=t and column_name='created_by'
    ) into v_has_created;
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
  foreach t in array array['supplier_po', 'supplier_po_line'] loop
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

grant select, insert, update, delete on public.supplier_po to authenticated;
grant select, insert, update, delete on public.supplier_po_line to authenticated;
