-- Defence Contract CRM — Phase 2: Document vault basics (T2.5)
-- Metadata tables for the private document vault, plus links to any entity.
-- Files live in private Supabase Storage buckets; access is only ever through
-- a server-issued signed URL after an RLS-checked read.
-- Idempotent. Depends on 0001_foundation.sql and 0003_requirements.sql.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'scan_status') then
    create type public.scan_status as enum
      ('pending', 'unscanned', 'clean', 'infected');
  end if;
  if not exists (select 1 from pg_type where typname = 'document_link_entity') then
    create type public.document_link_entity as enum (
      'requirement', 'requirement_line', 'customer', 'product', 'partner',
      'quotation', 'customer_po', 'invoice', 'approval', 'clarification'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. document
-- ---------------------------------------------------------------------------
create table if not exists public.document (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  document_type text,
  confidentiality text not null default 'internal'
    check (confidentiality in ('internal', 'confidential', 'restricted')),
  notes text,
  is_active boolean not null default true,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists document_type_idx on public.document (document_type);

-- ---------------------------------------------------------------------------
-- 3. document_version
-- ---------------------------------------------------------------------------
create table if not exists public.document_version (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.document (id) on delete cascade,
  version_no integer not null check (version_no > 0),
  bucket_id text not null default 'documents',
  object_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text,
  scan_status public.scan_status not null default 'unscanned',
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  unique (document_id, version_no),
  unique (bucket_id, object_path)
);

create index if not exists document_version_document_idx
  on public.document_version (document_id);

-- ---------------------------------------------------------------------------
-- 4. document_link (polymorphic, integrity-checked)
-- ---------------------------------------------------------------------------
create table if not exists public.document_link (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.document (id) on delete cascade,
  entity_type public.document_link_entity not null,
  entity_id uuid not null,
  linked_by uuid,
  created_at timestamptz not null default now(),
  unique (document_id, entity_type, entity_id)
);

create index if not exists document_link_entity_idx
  on public.document_link (entity_type, entity_id);

-- Existence check for the polymorphic link. Only entities that exist in this
-- schema in Phase 2 are checked; later-phase entities are accepted as-is.
create or replace function public.check_document_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
begin
  case new.entity_type
    when 'requirement' then
      select exists (select 1 from public.requirement where id = new.entity_id) into v_exists;
    when 'requirement_line' then
      select exists (select 1 from public.requirement_line where id = new.entity_id) into v_exists;
    when 'customer' then
      select exists (select 1 from public.customer where id = new.entity_id) into v_exists;
    when 'product' then
      select exists (select 1 from public.product where id = new.entity_id) into v_exists;
    when 'partner' then
      select exists (select 1 from public.partner where id = new.entity_id) into v_exists;
    when 'approval' then
      select exists (select 1 from public.approval where id = new.entity_id) into v_exists;
    else
      v_exists := true;  -- later-phase entity types are not validated yet
  end case;

  if not v_exists then
    raise exception 'DOCUMENT_LINK_TARGET_MISSING: % % does not exist',
      new.entity_type, new.entity_id;
  end if;
  return new;
end;
$$;

drop trigger if exists document_link_check on public.document_link;
create trigger document_link_check
  before insert or update on public.document_link
  for each row execute function public.check_document_link();

-- ---------------------------------------------------------------------------
-- 5. Audit, updated_at and row_version triggers
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
  v_has_updated boolean;
  v_has_version boolean;
  v_has_created boolean;
begin
  foreach t in array array['document', 'document_version', 'document_link'] loop
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
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Row Level Security
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  v_write text := 'public.has_any_role(array[''owner'',''sales'',''operations'',''admin'']::public.app_role[])';
begin
  foreach t in array array['document', 'document_version', 'document_link'] loop
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

-- No delete policy: documents are soft-deleted (is_active = false). Storage
-- objects are purged only by the retention job (later phase).

-- ---------------------------------------------------------------------------
-- 7. Private buckets and storage policies
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do update set public = false;
insert into storage.buckets (id, name, public)
values ('imports', 'imports', false)
on conflict (id) do update set public = false;
insert into storage.buckets (id, name, public)
values ('exports', 'exports', false)
on conflict (id) do update set public = false;

drop policy if exists "imports_read_authenticated" on storage.objects;
create policy "imports_read_authenticated"
  on storage.objects for select to authenticated
  using (bucket_id = 'imports');

drop policy if exists "imports_insert_authenticated" on storage.objects;
create policy "imports_insert_authenticated"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'imports');

drop policy if exists "exports_read_authenticated" on storage.objects;
create policy "exports_read_authenticated"
  on storage.objects for select to authenticated
  using (bucket_id = 'exports');

drop policy if exists "exports_insert_authenticated" on storage.objects;
create policy "exports_insert_authenticated"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'exports');

-- ---------------------------------------------------------------------------
-- 8. Access log (security events, e.g. signed-URL downloads)
-- ---------------------------------------------------------------------------
create table if not exists public.access_log (
  id bigserial primary key,
  actor uuid,
  action text not null,
  entity_type text,
  entity_id uuid,
  metadata jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists access_log_occurred_at_idx
  on public.access_log (occurred_at desc);
create index if not exists access_log_actor_idx on public.access_log (actor);

alter table public.access_log enable row level security;
drop policy if exists access_log_select on public.access_log;
create policy access_log_select on public.access_log
  for select to authenticated
  using (public.has_any_role(array['owner', 'admin']::public.app_role[]));
-- Append-only: writes go through public.log_access() only.

create or replace function public.log_access(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  insert into public.access_log (actor, action, entity_type, entity_id, metadata)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

grant execute on function public.log_access(text, text, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Grants
-- ---------------------------------------------------------------------------
grant select, insert, update on public.document to authenticated;
grant select, insert, update on public.document_version to authenticated;
grant select, insert, update, delete on public.document_link to authenticated;
grant select on public.access_log to authenticated;
