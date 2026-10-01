-- Defence Contract CRM — Phase 7: PO mismatch detection and acknowledgement gate (T7.3)
-- Rate, quantity and term differences are captured as po_mismatch rows, and a
-- customer PO cannot be acknowledged while a medium/high mismatch is unresolved
-- or its acceptance is not approved (FR-PO-02/03/04, BR-16).
-- Idempotent. Depends on 0020_customer_po.sql.

-- ---------------------------------------------------------------------------
-- 1. po_mismatch
-- ---------------------------------------------------------------------------
create table if not exists public.po_mismatch (
  id uuid primary key default gen_random_uuid(),
  customer_po_id uuid not null references public.customer_po (id) on delete cascade,
  po_line_id uuid references public.po_line (id) on delete cascade,
  field text not null,
  quoted_value text,
  po_value text,
  severity text not null default 'medium' check (severity in ('info', 'medium', 'high')),
  resolution text not null default 'open'
    check (resolution in ('open', 'corrected', 'amendment_requested', 'accepted')),
  approval_id uuid references public.approval (id) on delete set null,
  reason text,
  resolved_by uuid,
  resolved_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists po_mismatch_po_idx on public.po_mismatch (customer_po_id);
create index if not exists po_mismatch_line_idx on public.po_mismatch (po_line_id);

-- Helper: raise a mismatch and (for non-info) request an approval.
create or replace function public.raise_po_mismatch(
  p_po uuid,
  p_line uuid,
  p_field text,
  p_quoted text,
  p_po_value text,
  p_severity text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_approval uuid;
begin
  insert into public.po_mismatch
    (customer_po_id, po_line_id, field, quoted_value, po_value, severity)
  values (p_po, p_line, p_field, p_quoted, p_po_value, p_severity)
  returning id into v_id;

  if p_severity <> 'info' and auth.uid() is not null then
    v_approval := public.request_approval(
      'po_mismatch', v_id,
      format('PO mismatch on %s: quoted %s vs PO %s', p_field, p_quoted, p_po_value));
    update public.po_mismatch set approval_id = v_approval where id = v_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Line-level mismatch trigger (TECH-STACK §10.5)
-- ---------------------------------------------------------------------------
create or replace function public.po_line_mismatch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ql record;
  v_severity text;
  v_qty_severity text;
  v_won numeric;
begin
  -- Recompute open line mismatches.
  delete from public.po_mismatch
  where po_line_id = new.id and resolution = 'open';

  select proposed_unit_price, qty_quoted, uom, requirement_line_id, quotation_version_id
  into ql
  from public.quotation_line where id = new.quotation_line_id;
  if ql is null then
    return new;
  end if;

  if new.unit_rate <> ql.proposed_unit_price then
    perform public.raise_po_mismatch(
      new.customer_po_id, new.id, 'unit_rate',
      ql.proposed_unit_price::text, new.unit_rate::text, 'high');
  end if;

  if new.uom <> ql.uom then
    perform public.raise_po_mismatch(
      new.customer_po_id, new.id, 'uom', ql.uom, new.uom, 'high');
  end if;

  if new.qty_ordered <> ql.qty_quoted then
    -- A partial award is informational (downgrade).
    select coalesce(sum(lo.qty_won), 0) into v_won
    from public.line_outcome lo
    where lo.quotation_version_id = ql.quotation_version_id
      and lo.requirement_line_id = ql.requirement_line_id;

    if new.qty_ordered < ql.qty_quoted and v_won > 0 then
      v_qty_severity := 'info';
    elsif new.qty_ordered > ql.qty_quoted then
      v_qty_severity := 'high';
    else
      v_qty_severity := 'medium';
    end if;

    perform public.raise_po_mismatch(
      new.customer_po_id, new.id, 'qty',
      ql.qty_quoted::text, new.qty_ordered::text, v_qty_severity);
  end if;

  return new;
end;
$$;

drop trigger if exists po_line_mismatch_trg on public.po_line;
create trigger po_line_mismatch_trg
  after insert or update on public.po_line
  for each row execute function public.po_line_mismatch();

-- ---------------------------------------------------------------------------
-- 3. Header-level term mismatch trigger
-- ---------------------------------------------------------------------------
create or replace function public.po_header_mismatch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  qv record;
begin
  -- Only react when a term actually changes (or on insert).
  if tg_op = 'UPDATE'
     and new.payment_terms is not distinct from old.payment_terms
     and new.delivery_terms is not distinct from old.delivery_terms then
    return new;
  end if;

  select payment_terms, delivery_terms into qv
  from public.quotation_version where id = new.quotation_version_id;
  if qv is null then
    return new;
  end if;

  if new.payment_terms is not null and qv.payment_terms is not null
     and lower(btrim(new.payment_terms)) <> lower(btrim(qv.payment_terms))
     and not exists (
       select 1 from public.po_mismatch
       where customer_po_id = new.id and field = 'payment_terms'
     ) then
    perform public.raise_po_mismatch(
      new.id, null, 'payment_terms', qv.payment_terms, new.payment_terms, 'medium');
  end if;

  if new.delivery_terms is not null and qv.delivery_terms is not null
     and lower(btrim(new.delivery_terms)) <> lower(btrim(qv.delivery_terms))
     and not exists (
       select 1 from public.po_mismatch
       where customer_po_id = new.id and field = 'delivery_terms'
     ) then
    perform public.raise_po_mismatch(
      new.id, null, 'delivery_terms', qv.delivery_terms, new.delivery_terms, 'medium');
  end if;

  return new;
end;
$$;

drop trigger if exists po_header_mismatch_trg on public.customer_po;
create trigger po_header_mismatch_trg
  after insert or update on public.customer_po
  for each row execute function public.po_header_mismatch();

-- ---------------------------------------------------------------------------
-- 4. Status transitions with the acknowledgement gate
-- ---------------------------------------------------------------------------
insert into public.ref_status_transition (entity, from_status, to_status, requires_approval)
values
  ('customer_po', 'received', 'under_review', false),
  ('customer_po', 'received', 'cancelled', false),
  ('customer_po', 'under_review', 'acknowledged', false),
  ('customer_po', 'under_review', 'cancelled', false),
  ('customer_po', 'acknowledged', 'amended', false),
  ('customer_po', 'acknowledged', 'completed', false),
  ('customer_po', 'acknowledged', 'cancelled', false),
  ('customer_po', 'amended', 'acknowledged', false),
  ('customer_po', 'amended', 'completed', false),
  ('customer_po', 'amended', 'cancelled', false)
on conflict (entity, from_status, to_status) do nothing;

create or replace function public.transition_customer_po(
  p_id uuid,
  p_to_status public.customer_po_status,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.customer_po;
  v_allowed boolean;
  v_blocking integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.has_any_role(
    array['owner', 'sales', 'operations', 'admin']::public.app_role[]
  ) then
    raise exception 'FORBIDDEN: you may not change a customer PO';
  end if;

  select * into v_po from public.customer_po where id = p_id for update;
  if not found then
    raise exception 'Customer PO not found';
  end if;

  select true into v_allowed
  from public.ref_status_transition t
  where t.entity = 'customer_po'
    and t.from_status = v_po.status::text
    and t.to_status = p_to_status::text;
  if v_allowed is null then
    raise exception 'BR-30: invalid customer PO transition from % to %',
      v_po.status, p_to_status;
  end if;

  -- Acknowledgement gate (FR-PO-04).
  if p_to_status = 'acknowledged' then
    select count(*) into v_blocking
    from public.po_mismatch m
    where m.customer_po_id = p_id
      and m.severity in ('medium', 'high')
      and (
        m.resolution = 'open'
        or (
          m.resolution = 'accepted'
          and not exists (
            select 1 from public.approval a
            where a.id = m.approval_id and a.decision = 'approved'
          )
        )
      );
    if v_blocking > 0 then
      raise exception
        'FR-PO-04: % unresolved or unapproved mismatch(es) must be resolved before acknowledgement',
        v_blocking;
    end if;
  end if;

  update public.customer_po
     set status = p_to_status,
         acknowledged_at = case when p_to_status = 'acknowledged' then now() else acknowledged_at end,
         acknowledged_by = case when p_to_status = 'acknowledged' then auth.uid() else acknowledged_by end,
         updated_at = now()
   where id = p_id;

  insert into public.status_history
    (entity_type, entity_id, from_status, to_status, actor, reason)
  values
    ('customer_po', p_id, v_po.status::text, p_to_status::text, auth.uid(), p_reason);
end;
$$;

grant execute on function public.transition_customer_po(uuid, public.customer_po_status, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Audit, updated_at and RLS for po_mismatch
-- ---------------------------------------------------------------------------
do $$
begin
  execute 'drop trigger if exists po_mismatch_audit on public.po_mismatch';
  execute 'create trigger po_mismatch_audit after insert or update or delete on public.po_mismatch for each row execute function public.audit_row_change()';
  execute 'drop trigger if exists po_mismatch_updated_at on public.po_mismatch';
  execute 'create trigger po_mismatch_updated_at before update on public.po_mismatch for each row execute function public.set_updated_at()';
end
$$;

alter table public.po_mismatch enable row level security;
drop policy if exists po_mismatch_select on public.po_mismatch;
create policy po_mismatch_select on public.po_mismatch
  for select to authenticated using (true);
drop policy if exists po_mismatch_write on public.po_mismatch;
create policy po_mismatch_write on public.po_mismatch
  for all to authenticated
  using (public.has_any_role(array['owner','sales','operations','admin']::public.app_role[]))
  with check (public.has_any_role(array['owner','sales','operations','admin']::public.app_role[]));

grant select, insert, update, delete on public.po_mismatch to authenticated;
