-- Defence Contract CRM — Phase 0 foundation
-- Migration 0001: roles, profiles, user_roles, audit log, RLS, storage bucket.
-- Safe to run more than once (idempotent guards used throughout).

-- ---------------------------------------------------------------------------
-- 1. Role enum
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('owner', 'sales', 'operations', 'finance', 'admin');
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 2. profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'Application user profile, one row per auth.users row.';

-- ---------------------------------------------------------------------------
-- 3. user_roles (many roles per user)
-- ---------------------------------------------------------------------------
create table if not exists public.user_roles (
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create index if not exists user_roles_role_idx on public.user_roles (role);

-- ---------------------------------------------------------------------------
-- 4. Role helper functions (SECURITY DEFINER so they bypass RLS safely)
-- ---------------------------------------------------------------------------
create or replace function public.has_role(r public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = r
  );
$$;

create or replace function public.has_any_role(roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = auth.uid() and ur.role = any (roles)
  );
$$;

grant execute on function public.has_role(public.app_role) to authenticated;
grant execute on function public.has_any_role(public.app_role[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Generic updated_at trigger
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Audit log
-- ---------------------------------------------------------------------------
create table if not exists public.audit_events (
  id bigserial primary key,
  table_name text not null,
  record_id text,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  actor uuid,
  occurred_at timestamptz not null default now(),
  old_data jsonb,
  new_data jsonb,
  reason text
);

create index if not exists audit_events_occurred_at_idx
  on public.audit_events (occurred_at desc);
create index if not exists audit_events_table_name_idx
  on public.audit_events (table_name);
create index if not exists audit_events_actor_idx on public.audit_events (actor);

-- Generic audit trigger. Pass the primary-key column name as the trigger
-- argument; it defaults to 'id'. The actor is auth.uid() and an optional
-- human reason can be set per transaction with:
--   set local app.audit_reason = 'why this change was made';
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new jsonb;
  v_old jsonb;
  v_rec jsonb;
  v_id text;
  v_actor uuid := auth.uid();
  v_reason text := nullif(current_setting('app.audit_reason', true), '');
begin
  if tg_op <> 'DELETE' then
    v_new := to_jsonb(new);
  end if;
  if tg_op <> 'INSERT' then
    v_old := to_jsonb(old);
  end if;
  v_rec := coalesce(v_new, v_old);
  v_id := v_rec ->> coalesce(tg_argv[0], 'id');

  insert into public.audit_events
    (table_name, record_id, action, actor, old_data, new_data, reason)
  values
    (tg_table_name, v_id, tg_op, v_actor, v_old, v_new, v_reason);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Attach audit + updated_at triggers to foundation tables.
drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists profiles_audit on public.profiles;
create trigger profiles_audit
  after insert or update or delete on public.profiles
  for each row execute function public.audit_row_change();

drop trigger if exists user_roles_audit on public.user_roles;
create trigger user_roles_audit
  after insert or update or delete on public.user_roles
  for each row execute function public.audit_row_change('user_id');

-- ---------------------------------------------------------------------------
-- 7. Create a profile automatically for every new auth user
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email)
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    new.email
  )
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 8. Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.audit_events enable row level security;

-- profiles ------------------------------------------------------------------
drop policy if exists "profiles_select_self_or_managers" on public.profiles;
create policy "profiles_select_self_or_managers"
  on public.profiles for select
  to authenticated
  using (
    id = auth.uid()
    or public.has_any_role(array['owner', 'admin']::public.app_role[])
  );

drop policy if exists "profiles_update_self_or_admin" on public.profiles;
create policy "profiles_update_self_or_admin"
  on public.profiles for update
  to authenticated
  using (id = auth.uid() or public.has_role('admin'))
  with check (id = auth.uid() or public.has_role('admin'));

drop policy if exists "profiles_insert_admin" on public.profiles;
create policy "profiles_insert_admin"
  on public.profiles for insert
  to authenticated
  with check (public.has_role('admin'));

-- No delete policy: profiles are deleted only by cascade from auth.users.

-- user_roles ----------------------------------------------------------------
drop policy if exists "user_roles_select_self_or_admin" on public.user_roles;
create policy "user_roles_select_self_or_admin"
  on public.user_roles for select
  to authenticated
  using (user_id = auth.uid() or public.has_role('admin'));

drop policy if exists "user_roles_admin_insert" on public.user_roles;
create policy "user_roles_admin_insert"
  on public.user_roles for insert
  to authenticated
  with check (public.has_role('admin'));

drop policy if exists "user_roles_admin_update" on public.user_roles;
create policy "user_roles_admin_update"
  on public.user_roles for update
  to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

drop policy if exists "user_roles_admin_delete" on public.user_roles;
create policy "user_roles_admin_delete"
  on public.user_roles for delete
  to authenticated
  using (public.has_role('admin'));

-- audit_events --------------------------------------------------------------
-- Read-only for owner/admin. No INSERT policy (writes happen only through the
-- SECURITY DEFINER trigger). No UPDATE or DELETE policy at all: the audit log
-- is append-only.
drop policy if exists "audit_events_select_owner_admin" on public.audit_events;
create policy "audit_events_select_owner_admin"
  on public.audit_events for select
  to authenticated
  using (public.has_any_role(array['owner', 'admin']::public.app_role[]));

-- ---------------------------------------------------------------------------
-- 9. Private storage bucket for documents
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do update set public = false;

drop policy if exists "documents_read_authenticated" on storage.objects;
create policy "documents_read_authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'documents');

drop policy if exists "documents_insert_authenticated" on storage.objects;
create policy "documents_insert_authenticated"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'documents');

drop policy if exists "documents_delete_admin" on storage.objects;
create policy "documents_delete_admin"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'documents' and public.has_role('admin'));

-- ---------------------------------------------------------------------------
-- 10. Admin role management RPC
-- ---------------------------------------------------------------------------
-- The only supported way to change user_roles. It requires the admin role and
-- records a mandatory human reason in audit_events (via app.audit_reason).
create or replace function public.admin_set_user_role(
  p_user_id uuid,
  p_role public.app_role,
  p_action text,
  p_reason text
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
  if not public.has_role('admin') then
    raise exception 'FORBIDDEN: admin role required';
  end if;
  if p_action not in ('add', 'remove') then
    raise exception 'Invalid action: expected add or remove';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'A reason of at least 3 characters is required';
  end if;

  perform set_config('app.audit_reason', p_reason, true);

  if p_action = 'add' then
    insert into public.user_roles (user_id, role)
    values (p_user_id, p_role)
    on conflict (user_id, role) do nothing;
  else
    delete from public.user_roles
    where user_id = p_user_id and role = p_role;
  end if;
end;
$$;

grant execute on function public.admin_set_user_role(
  uuid, public.app_role, text, text
) to authenticated;
