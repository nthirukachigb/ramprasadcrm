-- Defence Contract CRM — Phase 2: Tender checklist with waiver approval (T2.6)
-- A required-document checklist per requirement, driven by editable templates.
-- A waiver requires an approved human approval record.
-- Idempotent. Depends on 0003_requirements.sql and 0004_documents.sql.

-- ---------------------------------------------------------------------------
-- 1. Templates
-- ---------------------------------------------------------------------------
create table if not exists public.checklist_template (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  bid_type public.bid_type,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.checklist_template_item (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.checklist_template (id) on delete cascade,
  item_key text not null,
  label text not null,
  is_mandatory boolean not null default true,
  sort_order integer not null default 0,
  unique (template_id, item_key)
);

-- ---------------------------------------------------------------------------
-- 2. Per-requirement checklist instance
-- ---------------------------------------------------------------------------
create table if not exists public.checklist_item (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.requirement (id) on delete cascade,
  item_key text not null,
  label text not null,
  is_mandatory boolean not null default true,
  status text not null default 'required'
    check (status in ('required', 'prepared', 'attached', 'waived')),
  document_id uuid references public.document (id) on delete set null,
  waiver_approval_id uuid references public.approval (id) on delete set null,
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requirement_id, item_key),
  constraint checklist_waiver_chk
    check (status <> 'waived' or waiver_approval_id is not null)
);

create index if not exists checklist_item_requirement_idx
  on public.checklist_item (requirement_id);

-- Open mandatory items used as a gate (T5.3).
create or replace function public.checklist_open_mandatory(p_requirement_id uuid)
returns setof public.checklist_item
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.checklist_item ci
  where ci.requirement_id = p_requirement_id
    and ci.is_mandatory
    and ci.status not in ('attached', 'waived')
  order by ci.sort_order, ci.label;
$$;

grant execute on function public.checklist_open_mandatory(uuid) to authenticated;

-- Seed the checklist instance when a requirement is created.
create or replace function public.seed_requirement_checklist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.checklist_item
    (requirement_id, item_key, label, is_mandatory, sort_order)
  select new.id, ti.item_key, ti.label, ti.is_mandatory, ti.sort_order
  from public.checklist_template_item ti
  join public.checklist_template t on t.id = ti.template_id
  where t.is_active
    and (t.bid_type is null or t.bid_type = new.bid_type)
  on conflict (requirement_id, item_key) do nothing;
  return new;
end;
$$;

drop trigger if exists requirement_seed_checklist on public.requirement;
create trigger requirement_seed_checklist
  after insert on public.requirement
  for each row execute function public.seed_requirement_checklist();

-- Default template applicable to every bid type.
do $$
declare
  v_template uuid;
begin
  select id into v_template from public.checklist_template where name = 'Standard tender checklist';
  if v_template is null then
    insert into public.checklist_template (name, bid_type)
    values ('Standard tender checklist', null)
    returning id into v_template;
  end if;

  insert into public.checklist_template_item (template_id, item_key, label, is_mandatory, sort_order)
  values
    (v_template, 'tender_document',     'Tender / RFQ document',              true, 10),
    (v_template, 'technical_spec',      'Technical specification',            true, 20),
    (v_template, 'price_schedule',      'Price schedule / BOQ',               true, 30),
    (v_template, 'compliance_certs',    'Compliance certificates',            true, 40),
    (v_template, 'bid_security',        'Bid security / EMD',                 true, 50),
    (v_template, 'authorisation_letter','Authorisation / declaration letter', false, 60)
  on conflict (template_id, item_key) do nothing;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Audit, updated_at and row_version triggers
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  v_has_updated boolean;
begin
  foreach t in array array[
    'checklist_template', 'checklist_template_item', 'checklist_item'
  ] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format(
      'create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()',
      t, t);

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'updated_at'
    ) into v_has_updated;
    if v_has_updated then
      execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
      execute format(
        'create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()',
        t, t);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Row Level Security
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  v_write text := 'public.has_any_role(array[''owner'',''sales'',''operations'',''admin'']::public.app_role[])';
begin
  foreach t in array array['checklist_item'] loop
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

do $$
declare
  t text;
  v_admin text := 'public.has_role(''admin'')';
begin
  foreach t in array array['checklist_template', 'checklist_template_item'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_select on public.%I', t, t);
    execute format(
      'create policy %I_select on public.%I for select to authenticated using (true)',
      t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format(
      'create policy %I_write on public.%I for all to authenticated using (%s) with check (%s)',
      t, t, v_admin, v_admin);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------
grant select, insert, update on public.checklist_item to authenticated;
grant select on public.checklist_template to authenticated;
grant select on public.checklist_template_item to authenticated;
