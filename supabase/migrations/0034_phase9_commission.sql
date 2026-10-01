-- Defence Contract CRM — Phase 9: commission eligibility and invoices (T9.6)
-- Creates proportional commission proposals when customer payments are allocated.
-- Idempotent. Depends on 0002_masters.sql and 0030_finance.sql.

create table if not exists public.commission_eligibility (
  id uuid primary key default gen_random_uuid(),
  trigger_allocation_id uuid not null references public.payment_allocation (id) on delete restrict,
  invoice_id uuid not null references public.invoice (id) on delete restrict,
  partner_id uuid not null references public.partner (id) on delete restrict,
  agreement_id uuid references public.commission_agreement (id) on delete set null,
  base_amount numeric(18,2) not null check (base_amount >= 0),
  commission_percent numeric(5,2) not null check (commission_percent >= 0 and commission_percent <= 100),
  commission_amount numeric(18,2) generated always as (round(base_amount * commission_percent / 100, 2)) stored,
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'invoiced', 'paid', 'exception', 'rejected')),
  exception_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trigger_allocation_id, partner_id)
);

create index if not exists commission_eligibility_partner_idx on public.commission_eligibility (partner_id, status);
create index if not exists commission_eligibility_invoice_idx on public.commission_eligibility (invoice_id);

create table if not exists public.commission_invoice (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partner (id) on delete restrict,
  eligibility_id uuid not null references public.commission_eligibility (id) on delete restrict,
  invoice_number text,
  amount numeric(18,2) not null check (amount > 0),
  status text not null default 'draft'
    check (status in ('draft', 'pending_approval', 'approved', 'issued', 'paid', 'cancelled')),
  approval_id uuid references public.approval (id) on delete set null,
  issued_at timestamptz,
  notes text,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (eligibility_id)
);

create index if not exists commission_invoice_partner_idx on public.commission_invoice (partner_id, status);

create or replace function public.create_commission_eligibility_for_allocation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_line record;
  v_agreement public.commission_agreement;
begin
  for v_line in
    select distinct
      po.customer_id,
      ql.id as quotation_line_id,
      po_line.requirement_line_id,
      orr.partner_id
    from public.invoice_line il
    join public.po_line po_line on po_line.id = il.po_line_id
    join public.customer_po po on po.id = po_line.customer_po_id
    join public.quotation_line ql on ql.id = po_line.quotation_line_id
    join public.oem_response_line orl on orl.id = ql.oem_response_line_id
    join public.oem_response orr on orr.id = orl.response_id
    where il.invoice_id = new.invoice_id
  loop
    select ca.* into v_agreement
    from public.commission_agreement ca
    where ca.partner_id = v_line.partner_id
      and ca.is_active
      and ca.effective_from <= current_date
      and (ca.effective_to is null or ca.effective_to >= current_date)
    order by ca.effective_from desc
    limit 1;

    insert into public.commission_eligibility (
      trigger_allocation_id, invoice_id, partner_id, agreement_id,
      base_amount, commission_percent, status, exception_reason
    ) values (
      new.id, new.invoice_id, v_line.partner_id, v_agreement.id,
      new.amount, coalesce(v_agreement.commission_percent, 0),
      case when v_agreement.id is null then 'exception' else 'proposed' end,
      case when v_agreement.id is null then 'No active commission agreement for this partner.' else null end
    )
    on conflict (trigger_allocation_id, partner_id) do nothing;
  end loop;
  return new;
end;
$$;

drop trigger if exists payment_allocation_commission on public.payment_allocation;
create trigger payment_allocation_commission
after insert on public.payment_allocation
for each row execute function public.create_commission_eligibility_for_allocation();

create or replace view public.v_commission_receivable
with (security_invoker = true) as
select
  ce.id as eligibility_id,
  ce.partner_id,
  p.name as partner_name,
  ce.invoice_id,
  ce.trigger_allocation_id,
  ce.base_amount,
  ce.commission_percent,
  ce.commission_amount,
  ce.status,
  ce.exception_reason,
  ci.id as commission_invoice_id,
  ci.invoice_number as commission_invoice_number,
  ci.status as commission_invoice_status
from public.commission_eligibility ce
join public.partner p on p.id = ce.partner_id
left join public.commission_invoice ci on ci.eligibility_id = ce.id;

grant select on public.v_commission_receivable to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['commission_eligibility', 'commission_invoice'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format('create policy %I_select on public.%I for select to authenticated using (public.has_any_role(array[''owner'',''finance'',''admin'']::public.app_role[]))', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format('create policy %I_write on public.%I for all to authenticated using (public.has_any_role(array[''owner'',''finance'',''admin'']::public.app_role[])) with check (public.has_any_role(array[''owner'',''finance'',''admin'']::public.app_role[]))', t, t);
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t, t);
    execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end
$$;

grant select, insert, update on public.commission_eligibility to authenticated;
grant select, insert, update on public.commission_invoice to authenticated;
