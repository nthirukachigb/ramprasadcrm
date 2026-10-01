-- Defence Contract CRM — Phase 7: Customer PO schema (T7.1)
-- A customer PO must reference an approved/submitted quotation version that
-- has an approval record. Deliveries are scheduled per line.
-- Idempotent. Depends on 0018_outcome.sql.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'customer_po_status') then
    create type public.customer_po_status as enum (
      'received', 'under_review', 'acknowledged', 'amended', 'completed', 'cancelled'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. customer_po
-- ---------------------------------------------------------------------------
create table if not exists public.customer_po (
  id uuid primary key default gen_random_uuid(),
  internal_ref text unique,
  quotation_version_id uuid not null references public.quotation_version (id),
  customer_id uuid not null references public.customer (id),
  customer_po_number text not null,
  po_date date,
  received_date date not null default current_date,
  customer_reference text,
  pdi_required boolean not null default false,
  ld_terms text,
  documents_required text,
  payment_terms text,
  delivery_terms text,
  status public.customer_po_status not null default 'received',
  acknowledgement_document_id uuid references public.document (id) on delete set null,
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  approval_id uuid references public.approval (id) on delete set null,
  notes text,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, customer_po_number)
);

create index if not exists customer_po_version_idx on public.customer_po (quotation_version_id);
create index if not exists customer_po_customer_idx on public.customer_po (customer_id);

create or replace function public.set_po_ref()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.internal_ref is null or btrim(new.internal_ref) = '' then
    new.internal_ref := public.next_ref('PO');
  end if;
  return new;
end;
$$;

drop trigger if exists customer_po_set_ref on public.customer_po;
create trigger customer_po_set_ref
  before insert on public.customer_po
  for each row execute function public.set_po_ref();

-- BR-02: the referenced quotation version must be approved/submitted with an
-- approval record.
create or replace function public.check_po_quotation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.quotation_status;
  v_approved_at timestamptz;
begin
  select status, approved_at into v_status, v_approved_at
  from public.quotation_version where id = new.quotation_version_id;

  if v_status is null then
    raise exception 'BR-02: the quotation version does not exist';
  end if;
  if v_status not in ('approved', 'submitted') then
    raise exception
      'BR-02: a customer PO must reference an approved or submitted quotation version (this one is %)',
      v_status;
  end if;
  if v_approved_at is null then
    raise exception 'BR-02: the quoted version has no approval record';
  end if;
  return new;
end;
$$;

drop trigger if exists customer_po_requires_approved on public.customer_po;
create trigger customer_po_requires_approved
  before insert or update on public.customer_po
  for each row execute function public.check_po_quotation();

-- ---------------------------------------------------------------------------
-- 2. po_line
-- ---------------------------------------------------------------------------
create table if not exists public.po_line (
  id uuid primary key default gen_random_uuid(),
  customer_po_id uuid not null references public.customer_po (id) on delete cascade,
  quotation_line_id uuid not null references public.quotation_line (id),
  requirement_line_id uuid not null references public.requirement_line (id),
  qty_ordered numeric(14, 3) not null check (qty_ordered > 0),
  qty_ordered_effective numeric(14, 3) not null check (qty_ordered_effective > 0),
  unit_rate numeric(14, 4) not null check (unit_rate > 0),
  uom text not null,
  delivery_terms text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_po_id, quotation_line_id)
);

create index if not exists po_line_po_idx on public.po_line (customer_po_id);
create index if not exists po_line_requirement_line_idx on public.po_line (requirement_line_id);

-- A PO line must reference a line of the PO's own quotation version.
create or replace function public.check_po_line_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match boolean;
begin
  select exists (
    select 1
    from public.quotation_line ql
    join public.customer_po po on po.id = new.customer_po_id
    where ql.id = new.quotation_line_id
      and ql.quotation_version_id = po.quotation_version_id
      and ql.requirement_line_id = new.requirement_line_id
  ) into v_match;
  if not v_match then
    raise exception 'BR-02: the PO line must belong to the PO''s quotation version';
  end if;
  return new;
end;
$$;

drop trigger if exists po_line_version on public.po_line;
create trigger po_line_version
  before insert or update on public.po_line
  for each row execute function public.check_po_line_version();

-- ---------------------------------------------------------------------------
-- 3. po_delivery_schedule (Σ qty = line qty, deferred)
-- ---------------------------------------------------------------------------
create table if not exists public.po_delivery_schedule (
  id uuid primary key default gen_random_uuid(),
  po_line_id uuid not null references public.po_line (id) on delete cascade,
  sequence integer not null default 1,
  qty numeric(14, 3) not null check (qty > 0),
  due_date date,
  original_committed_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (po_line_id, sequence)
);

create index if not exists po_delivery_schedule_line_idx
  on public.po_delivery_schedule (po_line_id);

-- original_committed_date is immutable once set.
create or replace function public.lock_original_committed_date()
returns trigger
language plpgsql
as $$
begin
  if old.original_committed_date is not null
     and new.original_committed_date is distinct from old.original_committed_date then
    raise exception 'BR-24: the original committed date cannot be changed';
  end if;
  return new;
end;
$$;

drop trigger if exists po_delivery_lock_original on public.po_delivery_schedule;
create trigger po_delivery_lock_original
  before update on public.po_delivery_schedule
  for each row execute function public.lock_original_committed_date();

-- Where a line has schedule rows, their quantities must sum to the line qty.
create or replace function public.check_po_schedule_sum()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line uuid := coalesce(new.po_line_id, old.po_line_id);
  v_sum numeric;
  v_effective numeric;
begin
  select coalesce(sum(qty), 0) into v_sum
  from public.po_delivery_schedule where po_line_id = v_line;

  select qty_ordered_effective into v_effective
  from public.po_line where id = v_line;

  if v_effective is null then
    return null;  -- line deleted
  end if;
  if v_sum > 0 and v_sum <> v_effective then
    raise exception
      'FR-PO-06: delivery schedule quantities (%) must equal the ordered quantity (%)',
      v_sum, v_effective;
  end if;
  return null;
end;
$$;

drop trigger if exists po_delivery_schedule_sum on public.po_delivery_schedule;
create constraint trigger po_delivery_schedule_sum
  after insert or update or delete on public.po_delivery_schedule
  deferrable initially deferred
  for each row execute function public.check_po_schedule_sum();

-- ---------------------------------------------------------------------------
-- 4. Audit, updated_at, row_version and actor stamping
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
  foreach t in array array['customer_po', 'po_line', 'po_delivery_schedule'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t, t);
    execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'row_version'
    ) into v_has_created;
    if v_has_created then
      execute format('drop trigger if exists %I_row_version on public.%I', t, t);
      execute format('create trigger %I_row_version before update on public.%I for each row execute function public.bump_row_version()', t, t);
    end if;

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'created_by'
    ) into v_has_created;
    if v_has_created then
      execute format('drop trigger if exists %I_stamp_actor on public.%I', t, t);
      execute format('create trigger %I_stamp_actor before insert or update on public.%I for each row execute function public.stamp_actor()', t, t);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Row Level Security and grants
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  v_write text := 'public.has_any_role(array[''owner'',''sales'',''operations'',''admin'']::public.app_role[])';
begin
  foreach t in array array['customer_po', 'po_line', 'po_delivery_schedule'] loop
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

grant select, insert, update, delete on public.customer_po to authenticated;
grant select, insert, update, delete on public.po_line to authenticated;
grant select, insert, update, delete on public.po_delivery_schedule to authenticated;
