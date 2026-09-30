-- Defence Contract CRM — Phase 2: Clarifications (T2.8)
-- Track missing specs and drawings raised against a requirement or line.
-- Idempotent. Depends on 0003_requirements.sql and 0004_documents.sql.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'clarification_status') then
    create type public.clarification_status as enum ('open', 'responded', 'closed');
  end if;
  if not exists (select 1 from pg_type where typname = 'clarification_type') then
    create type public.clarification_type as enum (
      'missing_specification', 'missing_drawing', 'outdated_drawing',
      'part_number_discrepancy', 'other'
    );
  end if;
end
$$;

create table if not exists public.clarification (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.requirement (id) on delete cascade,
  requirement_line_id uuid references public.requirement_line (id) on delete set null,
  clarification_type public.clarification_type not null default 'other',
  subject text not null,
  detail text,
  owner_user_id uuid references public.profiles (id) on delete set null,
  due_date date,
  status public.clarification_status not null default 'open',
  response_text text,
  response_document_id uuid references public.document (id) on delete set null,
  created_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists clarification_requirement_idx
  on public.clarification (requirement_id);
create index if not exists clarification_status_idx
  on public.clarification (status);

-- ---------------------------------------------------------------------------
-- Audit, updated_at and row_version triggers
-- ---------------------------------------------------------------------------
do $$
declare
  t text := 'clarification';
  v_has_updated boolean;
  v_has_version boolean;
  v_has_created boolean;
begin
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

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = t and column_name = 'row_version'
  ) into v_has_version;
  if v_has_version then
    execute format('drop trigger if exists %I_row_version on public.%I', t, t);
    execute format(
      'create trigger %I_row_version before update on public.%I for each row execute function public.bump_row_version()',
      t, t);
  end if;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = t and column_name = 'created_by'
  ) into v_has_created;
  if v_has_created then
    execute format('drop trigger if exists %I_stamp_actor on public.%I', t, t);
    execute format(
      'create trigger %I_stamp_actor before insert or update on public.%I for each row execute function public.stamp_actor()',
      t, t);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.clarification enable row level security;
drop policy if exists clarification_select on public.clarification;
create policy clarification_select on public.clarification
  for select to authenticated using (true);

drop policy if exists clarification_write on public.clarification;
create policy clarification_write on public.clarification
  for all to authenticated
  using (public.has_any_role(array['owner','sales','operations','admin']::public.app_role[]))
  with check (public.has_any_role(array['owner','sales','operations','admin']::public.app_role[]));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.clarification to authenticated;
