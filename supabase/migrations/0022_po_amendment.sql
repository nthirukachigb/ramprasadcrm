-- Defence Contract CRM — Phase 7: PO amendments (T7.4)
-- Amendments are versioned child records; both original and amended values stay
-- visible. Applying an amendment updates the effective quantity/rate and reruns
-- the mismatch check.
-- Idempotent. Depends on 0021_po_mismatch.sql.

create table if not exists public.po_amendment (
  id uuid primary key default gen_random_uuid(),
  customer_po_id uuid not null references public.customer_po (id) on delete cascade,
  amendment_no integer not null check (amendment_no > 0),
  amendment_date date not null default current_date,
  reason text,
  document_id uuid references public.document (id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'applied', 'cancelled')),
  approval_id uuid references public.approval (id) on delete set null,
  applied_at timestamptz,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_po_id, amendment_no)
);

create table if not exists public.po_amendment_change (
  id uuid primary key default gen_random_uuid(),
  po_amendment_id uuid not null references public.po_amendment (id) on delete cascade,
  po_line_id uuid not null references public.po_line (id) on delete cascade,
  field text not null check (field in ('qty', 'unit_rate', 'delivery_terms', 'other')),
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);

create index if not exists po_amendment_change_idx
  on public.po_amendment_change (po_amendment_id);

-- Apply an amendment: update effective quantity/rate, then re-run the mismatch
-- check (the po_line update trigger does this). Material changes raise an
-- approval request so the Owner records the decision.
create or replace function public.apply_po_amendment(p_amendment_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amendment public.po_amendment;
  v_change record;
  v_material boolean := false;
  v_approval uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.has_any_role(
    array['owner', 'sales', 'operations', 'admin']::public.app_role[]
  ) then
    raise exception 'FORBIDDEN: you may not apply a PO amendment';
  end if;

  select * into v_amendment from public.po_amendment where id = p_amendment_id for update;
  if not found then
    raise exception 'Amendment not found';
  end if;
  if v_amendment.status <> 'draft' then
    raise exception 'This amendment has already been applied';
  end if;

  for v_change in
    select * from public.po_amendment_change where po_amendment_id = p_amendment_id
  loop
    if v_change.field = 'qty' then
      update public.po_line
         set qty_ordered_effective = v_change.new_value::numeric
       where id = v_change.po_line_id;
      v_material := true;
    elsif v_change.field = 'unit_rate' then
      update public.po_line
         set unit_rate = v_change.new_value::numeric
       where id = v_change.po_line_id;
      v_material := true;
    elsif v_change.field = 'delivery_terms' then
      update public.po_line
         set delivery_terms = v_change.new_value
       where id = v_change.po_line_id;
    end if;
  end loop;

  if v_material and auth.uid() is not null then
    v_approval := public.request_approval(
      'po_amendment', p_amendment_id,
      coalesce(v_amendment.reason, 'PO amendment applied'));
  end if;

  update public.po_amendment
     set status = 'applied',
         applied_at = now(),
         approval_id = coalesce(v_approval, approval_id),
         updated_at = now()
   where id = p_amendment_id;

  update public.customer_po
     set status = 'amended', updated_at = now()
   where id = v_amendment.customer_po_id
     and status = 'acknowledged';
end;
$$;

grant execute on function public.apply_po_amendment(uuid) to authenticated;

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
begin
  foreach t in array array['po_amendment'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t, t);
    execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
    execute format('drop trigger if exists %I_row_version on public.%I', t, t);
    execute format('create trigger %I_row_version before update on public.%I for each row execute function public.bump_row_version()', t, t);
    execute format('drop trigger if exists %I_stamp_actor on public.%I', t, t);
    execute format('create trigger %I_stamp_actor before insert or update on public.%I for each row execute function public.stamp_actor()', t, t);
  end loop;
  execute 'drop trigger if exists po_amendment_change_audit on public.po_amendment_change';
  execute 'create trigger po_amendment_change_audit after insert or update or delete on public.po_amendment_change for each row execute function public.audit_row_change()';
end
$$;

do $$
declare
  t text;
  v_write text := 'public.has_any_role(array[''owner'',''sales'',''operations'',''admin'']::public.app_role[])';
begin
  foreach t in array array['po_amendment', 'po_amendment_change'] loop
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

grant select, insert, update, delete on public.po_amendment to authenticated;
grant select, insert, update, delete on public.po_amendment_change to authenticated;
