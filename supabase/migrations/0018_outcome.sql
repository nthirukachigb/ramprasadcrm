-- Defence Contract CRM — Phase 6: Outcome, partial award and loss reasons (T6.4)
-- Structured won/lost/cancelled outcomes per line; the header outcome is
-- derived. A loss or no-bid needs a reason (BR-29); "Other" needs text.
-- Idempotent. Depends on 0016_customer_response.sql.

-- ---------------------------------------------------------------------------
-- 1. loss_reason reference list
-- ---------------------------------------------------------------------------
create table if not exists public.loss_reason (
  code text primary key,
  label text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0
);

insert into public.loss_reason (code, label, sort_order)
values
  ('PRICE', 'Price', 10),
  ('DELIVERY', 'Delivery / lead time', 20),
  ('TECHNICAL', 'Technical non-compliance', 30),
  ('COMPLIANCE', 'Compliance / documentation', 40),
  ('QTY_SPLIT', 'Quantity split (part won)', 50),
  ('NO_RESPONSE', 'No customer response', 60),
  ('COMPETITOR', 'Competitor', 70),
  ('CUSTOMER_CANCELLED', 'Customer cancelled', 80),
  ('OTHER', 'Other', 90)
on conflict (code) do nothing;

alter table public.loss_reason enable row level security;
drop policy if exists loss_reason_select on public.loss_reason;
create policy loss_reason_select on public.loss_reason
  for select to authenticated using (true);
drop policy if exists loss_reason_admin on public.loss_reason;
create policy loss_reason_admin on public.loss_reason
  for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

-- ---------------------------------------------------------------------------
-- 2. line_outcome
-- ---------------------------------------------------------------------------
create table if not exists public.line_outcome (
  id uuid primary key default gen_random_uuid(),
  quotation_version_id uuid not null
    references public.quotation_version (id) on delete cascade,
  requirement_line_id uuid not null
    references public.requirement_line (id) on delete cascade,
  outcome text not null check (
    outcome in ('won', 'partially_won', 'lost', 'not_pursued', 'cancelled')
  ),
  qty_won numeric(14, 3) not null default 0 check (qty_won >= 0),
  qty_lost numeric(14, 3) not null default 0 check (qty_lost >= 0),
  loss_reason_code text references public.loss_reason (code),
  loss_reason_other text,
  competitor_partner_id uuid references public.partner (id) on delete set null,
  winning_price numeric(14, 4) check (winning_price is null or winning_price >= 0),
  l_position text,
  notes text,
  created_by uuid,
  updated_by uuid,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quotation_version_id, requirement_line_id),
  constraint line_outcome_reason_chk check (
    outcome not in ('lost', 'not_pursued') or loss_reason_code is not null
  ),
  constraint line_outcome_other_chk check (
    loss_reason_code is distinct from 'OTHER'
    or (loss_reason_other is not null and length(btrim(loss_reason_other)) >= 3)
  )
);

create index if not exists line_outcome_version_idx
  on public.line_outcome (quotation_version_id);
create index if not exists line_outcome_line_idx
  on public.line_outcome (requirement_line_id);

-- The awarded quantity cannot exceed the quoted quantity (FR-RESP-04).
create or replace function public.check_line_outcome_qty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quoted numeric;
begin
  select qty_quoted into v_quoted
  from public.quotation_line
  where quotation_version_id = new.quotation_version_id
    and requirement_line_id = new.requirement_line_id;

  if v_quoted is null then
    raise exception 'FR-RESP-04: there is no quoted line for this outcome';
  end if;
  if new.qty_won > v_quoted then
    raise exception 'FR-RESP-04: awarded quantity % exceeds quoted %', new.qty_won, v_quoted;
  end if;
  if new.outcome = 'lost'
     and new.loss_reason_code is null then
    raise exception 'BR-29: a lost line needs a loss reason';
  end if;
  return new;
end;
$$;

drop trigger if exists line_outcome_qty on public.line_outcome;
create trigger line_outcome_qty
  before insert or update on public.line_outcome
  for each row execute function public.check_line_outcome_qty();

-- ---------------------------------------------------------------------------
-- 3. Derived requirement outcome
-- ---------------------------------------------------------------------------
create or replace view public.v_requirement_outcome
with (security_invoker = true) as
select
  rl.requirement_id                    as requirement_id,
  sum(ql.qty_quoted)                   as qty_quoted,
  coalesce(sum(lo.qty_won), 0)         as qty_won,
  coalesce(sum(lo.qty_lost), 0)        as qty_lost,
  bool_or(lo.loss_reason_code = 'QTY_SPLIT') as has_qty_split,
  case
    when coalesce(sum(lo.qty_won), 0) > 0 and coalesce(sum(lo.qty_lost), 0) > 0
      then 'partially_won'
    when coalesce(sum(lo.qty_won), 0) > 0
      then 'won'
    when coalesce(sum(lo.qty_lost), 0) > 0
      then 'lost'
    else 'awaiting'
  end                                  as derived_outcome
from public.line_outcome lo
join public.quotation_version qv on qv.id = lo.quotation_version_id
join public.quotation_line ql
  on ql.quotation_version_id = lo.quotation_version_id
 and ql.requirement_line_id = lo.requirement_line_id
join public.requirement_line rl on rl.id = lo.requirement_line_id
group by rl.requirement_id;

grant select on public.v_requirement_outcome to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Audit, updated_at, row_version and actor stamping
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
begin
  foreach t in array array['line_outcome'] loop
    execute format('drop trigger if exists %I_audit on public.%I', t, t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()', t, t);
    execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
    execute format('drop trigger if exists %I_row_version on public.%I', t, t);
    execute format('create trigger %I_row_version before update on public.%I for each row execute function public.bump_row_version()', t, t);
    execute format('drop trigger if exists %I_stamp_actor on public.%I', t, t);
    execute format('create trigger %I_stamp_actor before insert or update on public.%I for each row execute function public.stamp_actor()', t, t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 5. Row Level Security and grants
-- ---------------------------------------------------------------------------
alter table public.line_outcome enable row level security;
drop policy if exists line_outcome_select on public.line_outcome;
create policy line_outcome_select on public.line_outcome
  for select to authenticated using (true);
drop policy if exists line_outcome_write on public.line_outcome;
create policy line_outcome_write on public.line_outcome
  for all to authenticated
  using (public.has_any_role(array['owner','sales','operations','admin']::public.app_role[]))
  with check (public.has_any_role(array['owner','sales','operations','admin']::public.app_role[]));

grant select, insert, update, delete on public.line_outcome to authenticated;
