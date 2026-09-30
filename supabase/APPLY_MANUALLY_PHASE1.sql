-- ===========================================================================
-- Defence Contract CRM - Phase 1 (Master data) - APPLY MANUALLY
-- ---------------------------------------------------------------------------
-- Run 0001_foundation.sql FIRST, then paste this file into the Supabase
-- SQL Editor (Dashboard > SQL Editor) and run it. Idempotent.
-- ===========================================================================
-- Defence Contract CRM — Phase 1: Master data
-- Customer, product/part and partner/OEM masters with RLS, audit and guards.
-- Idempotent: safe to run more than once.
-- Depends on 0001_foundation.sql.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'address_type') then
    create type public.address_type as enum
      ('billing', 'delivery', 'correspondence', 'registered', 'other');
  end if;
  if not exists (select 1 from pg_type where typname = 'contact_role') then
    create type public.contact_role as enum
      ('purchase', 'qa', 'inspector', 'finance', 'technical', 'management', 'other');
  end if;
  if not exists (select 1 from pg_type where typname = 'part_number_type') then
    create type public.part_number_type as enum
      ('internal', 'customer', 'oem', 'manufacturer');
  end if;
  if not exists (select 1 from pg_type where typname = 'approval_type') then
    create type public.approval_type as enum
      ('rcma', 'cemilac', 'lcso', 'dgqa', 'mil_standard', 'iso_9001', 'as9100', 'none');
  end if;
  if not exists (select 1 from pg_type where typname = 'price_type') then
    create type public.price_type as enum
      ('oem_cost', 'quoted', 'negotiated', 'po');
  end if;
  if not exists (select 1 from pg_type where typname = 'partner_type') then
    create type public.partner_type as enum
      ('oem', 'supplier', 'subcontractor', 'manufacturer', 'logistics_provider',
       'inspection_agency', 'approval_authority', 'competitor', 'agency');
  end if;
  if not exists (select 1 from pg_type where typname = 'partner_relationship_type') then
    create type public.partner_relationship_type as enum
      ('represented_oem', 'alternate_source', 'subcontract_capability');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. Generic helpers
-- ---------------------------------------------------------------------------
create or replace function public.bump_row_version()
returns trigger
language plpgsql
as $$
begin
  new.row_version = coalesce(old.row_version, 0) + 1;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Customer masters
-- ---------------------------------------------------------------------------
create table if not exists public.customer (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_normalized text generated always as
    (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored,
  legal_name text,
  customer_type text,
  default_payment_terms text,
  default_payment_terms_days integer,
  notes text,
  is_active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists customer_name_norm_uidx
  on public.customer (name_normalized);

create table if not exists public.customer_division (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customer (id) on delete cascade,
  name text not null,
  name_normalized text generated always as
    (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists customer_division_name_uidx
  on public.customer_division (customer_id, name_normalized);

create table if not exists public.customer_location (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customer (id) on delete cascade,
  division_id uuid references public.customer_division (id) on delete set null,
  label text,
  address_type public.address_type not null,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text not null default 'India',
  gstin text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customer_location_customer_idx
  on public.customer_location (customer_id);

create table if not exists public.customer_contact (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customer (id) on delete cascade,
  division_id uuid references public.customer_division (id) on delete set null,
  location_id uuid references public.customer_location (id) on delete set null,
  full_name text not null,
  designation text,
  role public.contact_role,
  email text,
  phone_e164 text,
  is_primary boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customer_contact_customer_idx
  on public.customer_contact (customer_id);

-- Restricted: encrypted registration values, RLS owner/finance/admin.
create table if not exists public.tax_registration (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customer (id) on delete cascade,
  registration_type text not null,
  value_encrypted text not null,
  value_last4 text not null,
  valid_from date,
  valid_to date,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tax_registration_customer_idx
  on public.tax_registration (customer_id);

-- Deliberately has NO credential/password column (PRD FR-CUST-04 / NG-12).
create table if not exists public.portal_reference (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customer (id) on delete cascade,
  portal_name text not null,
  portal_url text,
  responsible_user_id uuid references public.profiles (id) on delete set null,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists portal_reference_customer_idx
  on public.portal_reference (customer_id);

-- ---------------------------------------------------------------------------
-- 4. Product and part masters
-- ---------------------------------------------------------------------------
create table if not exists public.product (
  id uuid primary key default gen_random_uuid(),
  internal_part_number text not null,
  internal_part_number_normalized text generated always as
    (lower(regexp_replace(btrim(internal_part_number), '\s+', ' ', 'g'))) stored,
  description text not null,
  category text,
  uom text not null,
  hsn_code text,
  technical_specs text,
  moq numeric(14, 3),
  lead_time_days integer,
  shelf_life_days integer,
  warranty_text text,
  country_of_origin text,
  export_restricted boolean not null default false,
  standard_price numeric(14, 2),
  currency text not null default 'INR',
  is_active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists product_internal_pn_uidx
  on public.product (internal_part_number_normalized);

create table if not exists public.part_number (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.product (id) on delete cascade,
  part_number_type public.part_number_type not null,
  customer_id uuid references public.customer (id) on delete cascade,
  partner_id uuid,
  value text not null,
  value_normalized text generated always as
    (lower(regexp_replace(btrim(value), '\s+', ' ', 'g'))) stored,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint part_number_org_chk
    check (not (customer_id is not null and partner_id is not null))
);
create index if not exists part_number_product_idx on public.part_number (product_id);
create unique index if not exists part_number_customer_uidx
  on public.part_number (part_number_type, customer_id, value_normalized)
  where customer_id is not null;
create unique index if not exists part_number_partner_uidx
  on public.part_number (part_number_type, partner_id, value_normalized)
  where partner_id is not null;
create unique index if not exists part_number_internal_uidx
  on public.part_number (part_number_type, value_normalized)
  where customer_id is null and partner_id is null;

create table if not exists public.product_approval_requirement (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.product (id) on delete cascade,
  approval_type public.approval_type not null,
  is_required boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists product_approval_req_uidx
  on public.product_approval_requirement (product_id, approval_type);

create table if not exists public.product_approval_certificate (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.product (id) on delete cascade,
  approval_type public.approval_type not null,
  certificate_number text,
  issued_by text,
  valid_from date,
  valid_to date,
  document_reference text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists product_approval_cert_product_idx
  on public.product_approval_certificate (product_id);

create table if not exists public.product_price (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.product (id) on delete cascade,
  partner_id uuid,
  price_type public.price_type not null,
  amount numeric(14, 2) not null,
  currency text not null default 'INR',
  valid_from date,
  valid_to date,
  source text,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists product_price_product_idx on public.product_price (product_id);

-- ---------------------------------------------------------------------------
-- 5. Partner (OEM / supplier / subcontractor) masters
-- ---------------------------------------------------------------------------
create table if not exists public.partner (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  name_normalized text generated always as
    (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored,
  legal_name text,
  country text not null default 'India',
  vendor_code text,
  is_defence_qualified boolean not null default false,
  qualification_notes text,
  notes text,
  is_active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists partner_name_norm_uidx
  on public.partner (name_normalized);

create table if not exists public.partner_type_link (
  partner_id uuid not null references public.partner (id) on delete cascade,
  partner_type public.partner_type not null,
  primary key (partner_id, partner_type)
);

-- Deferred foreign keys to partner (declared after this table exists).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'part_number_partner_fk') then
    alter table public.part_number
      add constraint part_number_partner_fk
      foreign key (partner_id) references public.partner (id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'product_price_partner_fk') then
    alter table public.product_price
      add constraint product_price_partner_fk
      foreign key (partner_id) references public.partner (id) on delete set null;
  end if;
end
$$;

create table if not exists public.partner_location (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partner (id) on delete cascade,
  label text,
  address_type public.address_type not null default 'correspondence',
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text not null default 'India',
  gstin text,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists partner_location_partner_idx
  on public.partner_location (partner_id);

create table if not exists public.partner_contact (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partner (id) on delete cascade,
  location_id uuid references public.partner_location (id) on delete set null,
  full_name text not null,
  designation text,
  role public.contact_role,
  email text,
  phone_e164 text,
  is_primary boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists partner_contact_partner_idx
  on public.partner_contact (partner_id);

create table if not exists public.partner_capability (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partner (id) on delete cascade,
  capability text not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Restricted: encrypted bank details, RLS owner/finance only (FR-OEM-05).
create table if not exists public.partner_bank_account (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partner (id) on delete cascade,
  account_name_encrypted text not null,
  account_number_encrypted text not null,
  account_number_last4 text not null,
  ifsc_encrypted text not null,
  ifsc_last4 text not null,
  bank_name text,
  branch text,
  swift_encrypted text,
  swift_last4 text,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists partner_bank_partner_idx
  on public.partner_bank_account (partner_id);

create table if not exists public.commission_agreement (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partner (id) on delete cascade,
  commission_percent numeric(5, 2) not null
    check (commission_percent >= 0 and commission_percent <= 100),
  effective_from date not null,
  effective_to date,
  pricing_validity_days integer,
  freight_terms text,
  warranty_terms text,
  moq_rule text,
  nda_status text,
  notes text,
  approved_by uuid,
  approved_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commission_period_chk
    check (effective_to is null or effective_to >= effective_from)
);
create index if not exists commission_agreement_partner_idx
  on public.commission_agreement (partner_id);

create table if not exists public.partner_product (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partner (id) on delete cascade,
  product_id uuid not null references public.product (id) on delete cascade,
  relationship_type public.partner_relationship_type not null,
  exclusive_representation boolean not null default false,
  lead_time_days integer,
  moq numeric(14, 3),
  price_valid_until date,
  approved_source boolean not null default false,
  approved_evidence text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists partner_product_uidx
  on public.partner_product (partner_id, product_id, relationship_type);

-- ---------------------------------------------------------------------------
-- 6. Business guards
-- ---------------------------------------------------------------------------
-- Overlapping commission agreements are rejected (FR-OEM-04).
create or replace function public.enforce_no_overlapping_agreements()
returns trigger
language plpgsql
as $$
declare
  v_conflict integer;
begin
  select count(*) into v_conflict
  from public.commission_agreement ca
  where ca.partner_id = new.partner_id
    and ca.id <> new.id
    and daterange(ca.effective_from, coalesce(ca.effective_to, 'infinity'), '[]')
        && daterange(new.effective_from, coalesce(new.effective_to, 'infinity'), '[]');
  if v_conflict > 0 then
    raise exception
      'OVERLAPPING_AGREEMENT: partner already has an agreement covering this period';
  end if;
  return new;
end;
$$;

drop trigger if exists commission_agreement_no_overlap on public.commission_agreement;
create trigger commission_agreement_no_overlap
  before insert or update on public.commission_agreement
  for each row execute function public.enforce_no_overlapping_agreements();

-- A second represented OEM on an exclusively represented product is blocked
-- unless the Owner has approved the override (FR-OEM-03).
create or replace function public.enforce_partner_product_exclusivity()
returns trigger
language plpgsql
as $$
begin
  if new.relationship_type = 'represented_oem' and new.is_active then
    if exists (
      select 1 from public.partner_product pp
      where pp.product_id = new.product_id
        and pp.relationship_type = 'represented_oem'
        and pp.is_active
        and pp.exclusive_representation
        and pp.id <> new.id
    ) then
      if coalesce(current_setting('app.exclusivity_override', true), '') <> 'approved' then
        raise exception
          'EXCLUSIVITY_CONFLICT: product already has an exclusive represented OEM; owner approval required';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists partner_product_exclusivity on public.partner_product;
create trigger partner_product_exclusivity
  before insert or update on public.partner_product
  for each row execute function public.enforce_partner_product_exclusivity();

-- Approved write path for partner_product that records a reason and lets the
-- Owner/Admin pass the exclusivity override.
create or replace function public.create_partner_product(
  p_partner_id uuid,
  p_product_id uuid,
  p_relationship_type public.partner_relationship_type,
  p_exclusive_representation boolean,
  p_lead_time_days integer,
  p_moq numeric,
  p_approved_source boolean,
  p_approved_evidence text,
  p_notes text,
  p_override boolean,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_override then
    if not public.has_any_role(array['owner', 'admin']::public.app_role[]) then
      raise exception 'FORBIDDEN: only the Owner or Admin may approve an exclusivity override';
    end if;
    if p_reason is null or length(btrim(p_reason)) < 3 then
      raise exception 'A reason of at least 3 characters is required for an override';
    end if;
    perform set_config('app.exclusivity_override', 'approved', true);
  end if;

  if p_reason is not null and length(btrim(p_reason)) >= 3 then
    perform set_config('app.audit_reason', p_reason, true);
  end if;

  insert into public.partner_product (
    partner_id, product_id, relationship_type, exclusive_representation,
    lead_time_days, moq, approved_source, approved_evidence, notes
  )
  values (
    p_partner_id, p_product_id, p_relationship_type, coalesce(p_exclusive_representation, false),
    p_lead_time_days, p_moq, coalesce(p_approved_source, false), p_approved_evidence, p_notes
  )
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.create_partner_product(
  uuid, uuid, public.partner_relationship_type, boolean, integer, numeric,
  boolean, text, text, boolean, text
) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Triggers: audit, updated_at and row_version (all Phase 1 tables)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  v_has_updated boolean;
  v_has_version boolean;
begin
  foreach t in array array[
    'customer', 'customer_division', 'customer_location', 'customer_contact',
    'tax_registration', 'portal_reference', 'product', 'part_number',
    'product_approval_requirement', 'product_approval_certificate',
    'product_price', 'partner', 'partner_type_link', 'partner_location',
    'partner_contact', 'partner_capability', 'partner_bank_account',
    'commission_agreement', 'partner_product'
  ] loop
    execute format(
      'drop trigger if exists %I_audit on public.%I', t, t);
    execute format(
      'create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()',
      t, t);

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'updated_at'
    ) into v_has_updated;
    if v_has_updated then
      execute format(
        'drop trigger if exists %I_updated_at on public.%I', t, t);
      execute format(
        'create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()',
        t, t);
    end if;

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'row_version'
    ) into v_has_version;
    if v_has_version then
      execute format(
        'drop trigger if exists %I_row_version on public.%I', t, t);
      execute format(
        'create trigger %I_row_version before update on public.%I for each row execute function public.bump_row_version()',
        t, t);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 8. Row Level Security
-- ---------------------------------------------------------------------------
-- Group A: standard masters. Read for any authenticated user; write for
-- owner / sales / operations / admin.
do $$
declare
  t text;
  v_write text := 'public.has_any_role(array[''owner'',''sales'',''operations'',''admin'']::public.app_role[])';
begin
  foreach t in array array[
    'customer', 'customer_division', 'customer_location', 'product',
    'part_number', 'product_approval_requirement',
    'product_approval_certificate', 'product_price', 'partner',
    'partner_type_link', 'partner_location', 'partner_capability',
    'partner_product'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (true)',
      t, t);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (%s)',
      t, t, v_write);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (%s) with check (%s)',
      t, t, v_write, v_write);
  end loop;
end
$$;

-- Group B: contacts. Read and write for owner / sales / operations / admin.
do $$
declare
  t text;
  v_roles text := 'public.has_any_role(array[''owner'',''sales'',''operations'',''admin'']::public.app_role[])';
begin
  foreach t in array array['customer_contact', 'partner_contact'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (%s)',
      t, t, v_roles);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (%s)',
      t, t, v_roles);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (%s) with check (%s)',
      t, t, v_roles, v_roles);
  end loop;
end
$$;

-- Group C: restricted financial/secret tables.
-- tax_registration and commission_agreement: owner / finance / admin.
do $$
declare
  t text;
  v_roles text := 'public.has_any_role(array[''owner'',''finance'',''admin'']::public.app_role[])';
begin
  foreach t in array array['tax_registration', 'commission_agreement'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (%s)',
      t, t, v_roles);
    execute format('drop policy if exists %I_insert on public.%I', t, t);
    execute format(
      'create policy %I_insert on public.%I for insert to authenticated with check (%s)',
      t, t, v_roles);
    execute format('drop policy if exists %I_update on public.%I', t, t);
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (%s) with check (%s)',
      t, t, v_roles, v_roles);
  end loop;
end
$$;

-- portal_reference: owner / sales / finance / admin.
alter table public.portal_reference enable row level security;
drop policy if exists portal_reference_select on public.portal_reference;
create policy portal_reference_select on public.portal_reference
  for select to authenticated
  using (public.has_any_role(array['owner','sales','finance','admin']::public.app_role[]));
drop policy if exists portal_reference_insert on public.portal_reference;
create policy portal_reference_insert on public.portal_reference
  for insert to authenticated
  with check (public.has_any_role(array['owner','sales','finance','admin']::public.app_role[]));
drop policy if exists portal_reference_update on public.portal_reference;
create policy portal_reference_update on public.portal_reference
  for update to authenticated
  using (public.has_any_role(array['owner','sales','finance','admin']::public.app_role[]))
  with check (public.has_any_role(array['owner','sales','finance','admin']::public.app_role[]));

-- partner_bank_account: owner / finance ONLY (FR-OEM-05 acceptance criterion).
alter table public.partner_bank_account enable row level security;
drop policy if exists partner_bank_select on public.partner_bank_account;
create policy partner_bank_select on public.partner_bank_account
  for select to authenticated
  using (public.has_any_role(array['owner','finance']::public.app_role[]));
drop policy if exists partner_bank_insert on public.partner_bank_account;
create policy partner_bank_insert on public.partner_bank_account
  for insert to authenticated
  with check (public.has_any_role(array['owner','finance']::public.app_role[]));
drop policy if exists partner_bank_update on public.partner_bank_account;
create policy partner_bank_update on public.partner_bank_account
  for update to authenticated
  using (public.has_any_role(array['owner','finance']::public.app_role[]))
  with check (public.has_any_role(array['owner','finance']::public.app_role[]));

-- ---------------------------------------------------------------------------
-- 9. Grants
-- ---------------------------------------------------------------------------
grant select, insert, update on all tables in schema public to authenticated;

