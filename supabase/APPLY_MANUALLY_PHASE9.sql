-- ===========================================================================
-- Defence Contract CRM - Phase 9 (Finance: invoice, payment, deduction)
-- ---------------------------------------------------------------------------
-- Run APPLY_MANUALLY_PHASE8.sql first, then paste this file into the Supabase
-- SQL Editor and run it. Idempotent (safe to re-run).
--   0030_finance.sql
-- ===========================================================================

-- >>> supabase/migrations/0030_finance.sql
-- Defence Contract CRM — Phase 9: invoice, payment and deduction foundation
-- Core finance flow for invoice register, payment allocation and deduction tracking.
-- Idempotent. Depends on Phase 8 fulfilment tables.

create table if not exists public.invoice (
  id uuid primary key default gen_random_uuid(),
  internal_ref text unique,
  customer_po_id uuid not null references public.customer_po (id) on delete cascade,
  invoice_number text not null,
  invoice_date date not null default current_date,
  due_date date,
  tax_amount numeric(18,2) not null default 0 check (tax_amount >= 0),
  gross_amount numeric(18,2) not null default 0 check (gross_amount >= 0),
  status text not null default 'submitted'
    check (status in ('draft', 'submitted', 'partially_paid', 'paid', 'disputed', 'closed')),
  notes text,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_po_id, invoice_number)
);

create index if not exists invoice_po_idx on public.invoice (customer_po_id);
create index if not exists invoice_status_idx on public.invoice (status);

create or replace function public.set_invoice_ref()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.internal_ref is null or btrim(new.internal_ref) = '' then
    new.internal_ref := public.next_ref('INV');
  end if;
  return new;
end;
$$;

drop trigger if exists invoice_set_ref on public.invoice;
create trigger invoice_set_ref
  before insert on public.invoice
  for each row execute function public.set_invoice_ref();

create table if not exists public.invoice_line (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoice (id) on delete cascade,
  po_line_id uuid not null references public.po_line (id) on delete restrict,
  qty_invoiced numeric(14,3) not null check (qty_invoiced > 0),
  unit_rate numeric(18,2) not null default 0 check (unit_rate >= 0),
  tax_rate numeric(18,2) not null default 0 check (tax_rate >= 0),
  line_amount numeric(18,2) not null default 0 check (line_amount >= 0),
  tax_amount numeric(18,2) not null default 0 check (tax_amount >= 0),
  gross_amount numeric(18,2) not null default 0 check (gross_amount >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (invoice_id, po_line_id)
);

create index if not exists invoice_line_po_idx on public.invoice_line (po_line_id);

create table if not exists public.payment (
  id uuid primary key default gen_random_uuid(),
  internal_ref text unique,
  payment_date date not null default current_date,
  amount numeric(18,2) not null check (amount > 0),
  mode text not null default 'bank_transfer'
    check (mode in ('bank_transfer', 'cash', 'cheque', 'neft', 'rtgs', 'wire', 'other')),
  reference_no text,
  status text not null default 'received'
    check (status in ('received', 'allocated', 'reversed', 'disputed')),
  notes text,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_date_idx on public.payment (payment_date);

create or replace function public.set_payment_ref()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.internal_ref is null or btrim(new.internal_ref) = '' then
    new.internal_ref := public.next_ref('PAY');
  end if;
  return new;
end;
$$;

drop trigger if exists payment_set_ref on public.payment;
create trigger payment_set_ref
  before insert on public.payment
  for each row execute function public.set_payment_ref();

create table if not exists public.payment_allocation (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payment (id) on delete cascade,
  invoice_id uuid not null references public.invoice (id) on delete restrict,
  amount numeric(18,2) not null check (amount > 0),
  status text not null default 'allocated'
    check (status in ('allocated', 'settled', 'reversed')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payment_id, invoice_id)
);

create index if not exists payment_allocation_invoice_idx on public.payment_allocation (invoice_id);

create table if not exists public.deduction (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoice (id) on delete cascade,
  deduction_type text not null,
  amount numeric(18,2) not null default 0 check (amount >= 0),
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'rejected', 'disputed', 'settled')),
  rate_as_advised numeric(18,2),
  notes text,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deduction_invoice_idx on public.deduction (invoice_id);

create or replace view public.v_invoice_balance
with (security_invoker = true) as
select
  i.id as invoice_id,
  i.customer_po_id,
  i.gross_amount,
  coalesce(sum(pa.amount), 0) as paid_amount,
  coalesce(sum(d.amount), 0) as deduction_amount,
  i.gross_amount - coalesce(sum(pa.amount), 0) - coalesce(sum(d.amount), 0) as balance_amount
from public.invoice i
left join public.payment_allocation pa on pa.invoice_id = i.id
left join public.deduction d on d.invoice_id = i.id
group by i.id, i.customer_po_id, i.gross_amount;
