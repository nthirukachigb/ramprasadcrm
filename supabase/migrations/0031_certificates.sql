-- Defence Contract CRM — Phase 10: certificate chain and expiry framework
-- Insert-only history for validity extensions and renewals, plus effective validity views.

create table if not exists public.compliance_approval (
  id uuid primary key default gen_random_uuid(),
  authority text,
  certificate_no text not null,
  certificate_date date not null,
  valid_until date not null,
  apply_for_renewal_by date,
  notes text,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (certificate_no)
);

create index if not exists compliance_approval_valid_idx on public.compliance_approval (valid_until);

create table if not exists public.certificate_extension (
  id uuid primary key default gen_random_uuid(),
  approval_id uuid not null references public.compliance_approval (id) on delete cascade,
  seq integer not null check (seq between 1 and 2),
  extended_until date not null,
  reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (approval_id, seq)
);

create index if not exists cert_ext_approval_idx on public.certificate_extension (approval_id);

create table if not exists public.certificate_renewal (
  id uuid primary key default gen_random_uuid(),
  predecessor_id uuid not null references public.compliance_approval (id) on delete restrict,
  successor_id uuid not null references public.compliance_approval (id) on delete restrict,
  renewal_date date not null,
  new_valid_until date not null,
  reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (predecessor_id, successor_id)
);

create or replace function public.block_certificate_history_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'BR-20: certificate history records are insert-only';
end;
$$;

drop trigger if exists cert_ext_history_guard on public.certificate_extension;
create trigger cert_ext_history_guard
  before update or delete on public.certificate_extension
  for each row execute function public.block_certificate_history_mutation();

drop trigger if exists cert_renewal_history_guard on public.certificate_renewal;
create trigger cert_renewal_history_guard
  before update or delete on public.certificate_renewal
  for each row execute function public.block_certificate_history_mutation();

create or replace view public.v_certificate_effective_validity
with (security_invoker = true) as
select
  ca.id as approval_id,
  ca.certificate_no,
  ca.certificate_date,
  ca.valid_until as original_valid_until,
  coalesce(max(ce.extended_until), ca.valid_until) as effective_valid_until,
  ca.apply_for_renewal_by,
  coalesce(
    (select max(cr.new_valid_until)
     from public.certificate_renewal cr
     where cr.predecessor_id = ca.id),
    coalesce(max(ce.extended_until), ca.valid_until)
  ) as effective_renewed_until
from public.compliance_approval ca
left join public.certificate_extension ce on ce.approval_id = ca.id
group by ca.id, ca.certificate_no, ca.certificate_date, ca.valid_until, ca.apply_for_renewal_by;

create or replace view public.v_document_expiry
with (security_invoker = true) as
select
  d.id as document_id,
  d.title,
  d.document_type,
  dv.id as version_id,
  dv.file_name,
  d.created_at,
  dv.created_at as version_created_at
from public.document d
left join public.document_version dv on dv.document_id = d.id
where d.is_active = true;
