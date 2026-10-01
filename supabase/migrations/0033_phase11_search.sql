-- Defence Contract CRM — Phase 11: search and historical intelligence
-- Unified, RLS-trimmed search projection with normalized part-number matching.
-- Idempotent. Depends on migrations 0001 through 0032.

create extension if not exists pg_trgm;
create schema if not exists app;

create table if not exists public.search_document (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  tenant_org_id uuid,
  title text not null,
  ref_codes text[] not null default '{}',
  part_nos_norm text[] not null default '{}',
  body tsvector not null default ''::tsvector,
  search_text text not null default '',
  customer_id uuid,
  partner_id uuid,
  status text,
  event_date timestamptz,
  updated_at timestamptz not null default now(),
  unique (entity_type, entity_id)
);

create index if not exists search_document_body_idx on public.search_document using gin (body);
create index if not exists search_document_title_trgm_idx on public.search_document using gin (title gin_trgm_ops);
create index if not exists search_document_text_trgm_idx on public.search_document using gin (search_text gin_trgm_ops);
create index if not exists search_document_refs_idx on public.search_document using gin (ref_codes);
create index if not exists search_document_parts_idx on public.search_document using gin (part_nos_norm);
create index if not exists search_document_scope_idx
  on public.search_document (tenant_org_id, entity_type, event_date desc);

alter table public.search_document enable row level security;
drop policy if exists search_document_select on public.search_document;
create policy search_document_select on public.search_document
  for select to authenticated using (true);
grant select on public.search_document to authenticated;

create or replace function public.search_part_key(p_value text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(regexp_replace(upper(btrim(coalesce(p_value, ''))), '[[:space:]\-./]', '', 'g'), '');
$$;

grant execute on function public.search_part_key(text) to authenticated;

create or replace function public.refresh_search_document(
  p_entity_type text,
  p_entity_id uuid,
  p_title text,
  p_ref_codes text[] default '{}',
  p_part_nos text[] default '{}',
  p_search_text text default '',
  p_customer_id uuid default null,
  p_partner_id uuid default null,
  p_status text default null,
  p_event_date timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parts text[];
  v_text text := concat_ws(' ', p_title, array_to_string(p_ref_codes, ' '), array_to_string(p_part_nos, ' '), p_search_text);
begin
  select coalesce(array_agg(distinct public.search_part_key(x) order by public.search_part_key(x)) filter (where public.search_part_key(x) is not null), '{}')
    into v_parts
  from unnest(coalesce(p_part_nos, '{}')) as part_value(x);

  insert into public.search_document (
    entity_type, entity_id, title, ref_codes, part_nos_norm, body, search_text,
    customer_id, partner_id, status, event_date, updated_at
  ) values (
    p_entity_type, p_entity_id, coalesce(nullif(p_title, ''), p_entity_type),
    coalesce(p_ref_codes, '{}'), v_parts, to_tsvector('simple', v_text), v_text,
    p_customer_id, p_partner_id, p_status, p_event_date, now()
  )
  on conflict (entity_type, entity_id) do update set
    title = excluded.title,
    ref_codes = excluded.ref_codes,
    part_nos_norm = excluded.part_nos_norm,
    body = excluded.body,
    search_text = excluded.search_text,
    customer_id = excluded.customer_id,
    partner_id = excluded.partner_id,
    status = excluded.status,
    event_date = excluded.event_date,
    updated_at = now();
end;
$$;

grant execute on function public.refresh_search_document(text, uuid, text, text[], text[], text, uuid, uuid, text, timestamptz) to authenticated;

create or replace function public.maintain_search_document()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.search_document where entity_type = tg_table_name and entity_id = old.id;
    return old;
  end if;

  if tg_table_name = 'customer' then
    perform public.refresh_search_document('customer', new.id, new.name, '{}', '{}', coalesce(new.legal_name, '') || ' ' || coalesce(new.notes, ''), new.id, null, case when new.is_active then 'active' else 'inactive' end, new.updated_at);
  elsif tg_table_name = 'customer_division' then
    perform public.refresh_search_document('customer_division', new.id, new.name, '{}', '{}', coalesce(new.notes, ''), new.customer_id, null, case when new.is_active then 'active' else 'inactive' end, new.updated_at);
  elsif tg_table_name = 'partner' then
    perform public.refresh_search_document('partner', new.id, new.name, case when new.vendor_code is null then '{}' else array[new.vendor_code] end, '{}', coalesce(new.legal_name, '') || ' ' || coalesce(new.notes, ''), null, new.id, case when new.is_active then 'active' else 'inactive' end, new.updated_at);
  elsif tg_table_name = 'product' then
    perform public.refresh_search_document('product', new.id, new.description, array[new.internal_part_number], array[new.internal_part_number], coalesce(new.category, '') || ' ' || coalesce(new.technical_specs, ''), null, null, case when new.is_active then 'active' else 'inactive' end, new.updated_at);
  elsif tg_table_name = 'part_number' then
    perform public.refresh_search_document('product', new.product_id, (select p.description from public.product p where p.id = new.product_id), '{}', array[new.value], new.value_normalized, null, new.partner_id, case when new.is_active then 'active' else 'inactive' end, new.updated_at);
  elsif tg_table_name = 'requirement' then
    perform public.refresh_search_document('requirement', new.id, coalesce(new.project_name, new.internal_ref), array_remove(array[new.internal_ref, new.customer_reference, new.portal_tender_no], null), '{}', coalesce(new.project_name, '') || ' ' || coalesce(new.notes, ''), new.customer_id, null, new.status::text, new.updated_at);
  elsif tg_table_name = 'requirement_line' then
    perform public.refresh_search_document('requirement_line', new.id, new.description, array[new.line_no::text], array[new.internal_part_no, new.customer_part_no, new.oem_part_no], coalesce(new.specification_ref, '') || ' ' || coalesce(new.line_notes, ''), (select r.customer_id from public.requirement r where r.id = new.requirement_id), null, new.line_status::text, new.updated_at);
  elsif tg_table_name = 'quotation' then
    perform public.refresh_search_document('quotation', new.id, coalesce(new.internal_quote_no, new.id::text), array_remove(array[new.internal_quote_no, new.oem_quote_no], null), '{}', coalesce(new.notes, ''), (select r.customer_id from public.requirement r where r.id = new.requirement_id), null, null, new.updated_at);
  elsif tg_table_name = 'customer_po' then
    perform public.refresh_search_document('customer_po', new.id, coalesce(new.internal_ref, new.customer_po_number), array_remove(array[new.internal_ref, new.customer_po_number, new.customer_reference], null), '{}', coalesce(new.notes, '') || ' ' || coalesce(new.payment_terms, ''), new.customer_id, null, new.status::text, new.updated_at);
  elsif tg_table_name = 'invoice' then
    perform public.refresh_search_document('invoice', new.id, coalesce(new.internal_ref, new.invoice_number), array[new.internal_ref, new.invoice_number], '{}', coalesce(new.notes, ''), (select po.customer_id from public.customer_po po where po.id = new.customer_po_id), null, new.status, new.updated_at);
  elsif tg_table_name = 'document' then
    perform public.refresh_search_document('document', new.id, new.title, case when new.document_type is null then '{}' else array[new.document_type] end, '{}', coalesce(new.notes, ''), null, null, case when new.is_active then 'active' else 'inactive' end, new.updated_at);
  end if;
  return new;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['customer','customer_division','partner','product','part_number','requirement','requirement_line','quotation','customer_po','invoice','document'] loop
    execute format('drop trigger if exists search_document_%I on public.%I', v_table, v_table);
    execute format('create trigger search_document_%I after insert or update or delete on public.%I for each row execute function public.maintain_search_document()', v_table, v_table);
  end loop;
end
$$;

-- Backfill existing records. Re-running this block refreshes stale rows safely.
truncate public.search_document;
insert into public.search_document (entity_type, entity_id, title, ref_codes, part_nos_norm, body, search_text, customer_id, status, event_date)
select 'customer', c.id, c.name, '{}', '{}', to_tsvector('simple', concat_ws(' ', c.name, c.legal_name, c.notes)), concat_ws(' ', c.name, c.legal_name, c.notes), c.id, case when c.is_active then 'active' else 'inactive' end, c.updated_at from public.customer c;
insert into public.search_document (entity_type, entity_id, title, ref_codes, part_nos_norm, body, search_text, customer_id, status, event_date)
select 'customer_division', d.id, d.name, '{}', '{}', to_tsvector('simple', concat_ws(' ', d.name, d.notes)), concat_ws(' ', d.name, d.notes), d.customer_id, case when d.is_active then 'active' else 'inactive' end, d.updated_at from public.customer_division d;
insert into public.search_document (entity_type, entity_id, title, ref_codes, part_nos_norm, body, search_text, partner_id, status, event_date)
select 'partner', p.id, p.name, '{}', '{}', to_tsvector('simple', concat_ws(' ', p.name, p.legal_name, p.vendor_code, p.notes)), concat_ws(' ', p.name, p.legal_name, p.vendor_code, p.notes), p.id, case when p.is_active then 'active' else 'inactive' end, p.updated_at from public.partner p;
insert into public.search_document (entity_type, entity_id, title, ref_codes, part_nos_norm, body, search_text, status, event_date)
select 'product', p.id, p.description, array[p.internal_part_number], array[p.internal_part_number], to_tsvector('simple', concat_ws(' ', p.description, p.internal_part_number, p.category, p.technical_specs)), concat_ws(' ', p.description, p.internal_part_number, p.category, p.technical_specs), case when p.is_active then 'active' else 'inactive' end, p.updated_at from public.product p;
insert into public.search_document (entity_type, entity_id, title, ref_codes, part_nos_norm, body, search_text, customer_id, status, event_date)
select 'requirement', r.id, coalesce(r.project_name, r.internal_ref), array_remove(array[r.internal_ref, r.customer_reference, r.portal_tender_no], null), '{}', to_tsvector('simple', concat_ws(' ', r.internal_ref, r.project_name, r.customer_reference, r.portal_tender_no, r.notes)), concat_ws(' ', r.internal_ref, r.project_name, r.customer_reference, r.portal_tender_no, r.notes), r.customer_id, r.status::text, r.updated_at from public.requirement r;
insert into public.search_document (entity_type, entity_id, title, ref_codes, part_nos_norm, body, search_text, customer_id, status, event_date)
select 'requirement_line', rl.id, rl.description, array[rl.line_no::text], array[rl.internal_part_no, rl.customer_part_no, rl.oem_part_no], to_tsvector('simple', concat_ws(' ', rl.description, rl.internal_part_no, rl.customer_part_no, rl.oem_part_no, rl.specification_ref, rl.line_notes)), concat_ws(' ', rl.description, rl.internal_part_no, rl.customer_part_no, rl.oem_part_no, rl.specification_ref, rl.line_notes), r.customer_id, rl.line_status::text, rl.updated_at from public.requirement_line rl join public.requirement r on r.id = rl.requirement_id;
insert into public.search_document (entity_type, entity_id, title, ref_codes, part_nos_norm, body, search_text, customer_id, status, event_date)
select 'quotation', q.id, coalesce(q.internal_quote_no, q.id::text), array_remove(array[q.internal_quote_no, q.oem_quote_no], null), '{}', to_tsvector('simple', concat_ws(' ', q.internal_quote_no, q.oem_quote_no, q.notes)), concat_ws(' ', q.internal_quote_no, q.oem_quote_no, q.notes), r.customer_id, null, q.updated_at from public.quotation q join public.requirement r on r.id = q.requirement_id;
insert into public.search_document (entity_type, entity_id, title, ref_codes, part_nos_norm, body, search_text, customer_id, status, event_date)
select 'customer_po', po.id, coalesce(po.internal_ref, po.customer_po_number), array_remove(array[po.internal_ref, po.customer_po_number, po.customer_reference], null), '{}', to_tsvector('simple', concat_ws(' ', po.internal_ref, po.customer_po_number, po.customer_reference, po.notes, po.payment_terms)), concat_ws(' ', po.internal_ref, po.customer_po_number, po.customer_reference, po.notes, po.payment_terms), po.customer_id, po.status::text, po.updated_at from public.customer_po po;
insert into public.search_document (entity_type, entity_id, title, ref_codes, part_nos_norm, body, search_text, customer_id, status, event_date)
select 'invoice', i.id, coalesce(i.internal_ref, i.invoice_number), array[i.internal_ref, i.invoice_number], '{}', to_tsvector('simple', concat_ws(' ', i.internal_ref, i.invoice_number, i.notes)), concat_ws(' ', i.internal_ref, i.invoice_number, i.notes), po.customer_id, i.status, i.updated_at from public.invoice i join public.customer_po po on po.id = i.customer_po_id;
insert into public.search_document (entity_type, entity_id, title, ref_codes, part_nos_norm, body, search_text, event_date)
select 'document', d.id, d.title, case when d.document_type is null then '{}' else array[d.document_type] end, '{}', to_tsvector('simple', concat_ws(' ', d.title, d.document_type, d.notes)), concat_ws(' ', d.title, d.document_type, d.notes), d.updated_at from public.document d;

create or replace function app.search(
  p_q text,
  p_filters jsonb default '{}'::jsonb,
  p_limit integer default 50,
  p_cursor timestamptz default null
)
returns table (
  entity_type text,
  entity_id uuid,
  title text,
  ref_codes text[],
  status text,
  event_date timestamptz,
  match_kind text,
  rank real,
  customer_id uuid,
  partner_id uuid
)
language sql
stable
security invoker
set search_path = public, app
as $$
with input as (
  select
    btrim(coalesce(p_q, '')) as q_raw,
    regexp_replace(lower(btrim(coalesce(p_q, ''))), '[^a-z0-9]+', ' ', 'g') as q_norm,
    public.search_part_key(p_q) as part_key,
    coalesce(nullif(p_filters->>'entity_type', ''), null) as entity_filter,
    coalesce(nullif(p_filters->>'status', ''), null) as status_filter,
    nullif(p_filters->>'from', '')::date as from_date,
    nullif(p_filters->>'to', '')::date as to_date
), scored as (
  select sd.*,
    case
      when lower(input.q_raw) = any(array(select lower(x) from unnest(sd.ref_codes) x)) then 'exact'
      when input.part_key is not null and input.part_key = any(sd.part_nos_norm) then 'exact'
      when input.part_key is not null and exists (select 1 from unnest(sd.part_nos_norm) x where x like input.part_key || '%') then 'prefix'
      when input.q_raw <> '' and sd.search_text ilike '%' || input.q_raw || '%' then 'text'
      else 'similar'
    end as match_kind,
    (case when input.part_key is not null and input.part_key = any(sd.part_nos_norm) then 10 else 0 end
      + case when input.q_raw <> '' and sd.search_text ilike '%' || input.q_raw || '%' then 4 else 0 end
      + case when input.q_norm <> '' then ts_rank(sd.body, websearch_to_tsquery('simple', input.q_norm)) else 0 end
      + similarity(sd.title, input.q_raw) * 0.25)::real as result_rank
  from public.search_document sd cross join input
  where input.q_raw <> ''
    and (input.entity_filter is null or sd.entity_type = input.entity_filter)
    and (input.status_filter is null or sd.status = input.status_filter)
    and (input.from_date is null or sd.event_date::date >= input.from_date)
    and (input.to_date is null or sd.event_date::date <= input.to_date)
    and (p_cursor is null or sd.event_date < p_cursor)
    and (
      (input.q_norm <> '' and sd.body @@ websearch_to_tsquery('simple', input.q_norm))
      or sd.search_text ilike '%' || input.q_raw || '%'
      or (input.part_key is not null and exists (select 1 from unnest(sd.part_nos_norm) x where x % input.part_key))
      or sd.title % input.q_raw
    )
)
select entity_type, entity_id, title, ref_codes, status, event_date, match_kind, result_rank, customer_id, partner_id
from scored
order by result_rank desc, event_date desc nulls last, entity_id desc
limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

grant execute on function app.search(text, jsonb, integer, timestamptz) to authenticated;

create or replace function public.search(
  p_q text,
  p_filters jsonb default '{}'::jsonb,
  p_limit integer default 50,
  p_cursor timestamptz default null
)
returns table (
  entity_type text,
  entity_id uuid,
  title text,
  ref_codes text[],
  status text,
  event_date timestamptz,
  match_kind text,
  rank real,
  customer_id uuid,
  partner_id uuid
)
language sql
stable
security invoker
set search_path = public, app
as $$ select * from app.search(p_q, p_filters, p_limit, p_cursor); $$;

grant execute on function public.search(text, jsonb, integer, timestamptz) to authenticated;

create or replace function public.search_suggestions(p_q text, p_limit integer default 5)
returns table (title text, entity_type text, entity_id uuid, similarity real)
language sql
stable
security invoker
set search_path = public
as $$
  select title, entity_type, entity_id, similarity(title, p_q)::real
  from public.search_document
  where p_q is not null and btrim(p_q) <> '' and title % p_q
  order by similarity(title, p_q) desc
  limit least(greatest(coalesce(p_limit, 5), 1), 10);
$$;

grant execute on function public.search_suggestions(text, integer) to authenticated;

-- Phase 11 expands the existing history RPC with links and permission-aware
-- pricing fields while retaining the original columns used by the Phase 5 UI.
drop function if exists public.comparable_history(uuid);
create or replace function public.comparable_history(p_line_id uuid)
returns table (
  quotation_line_id uuid,
  requirement_id uuid,
  requirement_ref text,
  quotation_version_id uuid,
  quotation_id uuid,
  version_no integer,
  proposed_unit_price numeric,
  negotiated_unit_price numeric,
  po_unit_rate numeric,
  oem_name text,
  oem_cost_unit numeric,
  margin_pct numeric,
  lead_time_days integer,
  line_outcome text,
  loss_reason text,
  competitor text,
  winning_price numeric,
  pdi_rejected_qty numeric,
  is_migrated boolean,
  is_validated boolean,
  match_basis text
)
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_product_id uuid;
  v_part_key text;
  v_description text;
begin
  if not public.has_any_role(array['owner','sales','admin']::public.app_role[]) then
    raise exception 'FORBIDDEN: comparable history is available to Sales, Owner or Admin';
  end if;
  select rl.product_id, public.search_part_key(rl.part_no_norm), rl.description
    into v_product_id, v_part_key, v_description
  from public.requirement_line rl where rl.id = p_line_id;

  return query
  select bh.quotation_line_id, bh.requirement_id, bh.requirement_ref,
         bh.quotation_version_id, bh.quotation_id, bh.version_no,
         bh.proposed_unit_price, null::numeric,
         (select pl.unit_rate from public.po_line pl where pl.quotation_line_id = bh.quotation_line_id limit 1),
         (select p.name from public.partner p join public.oem_response ors on ors.partner_id = p.id join public.oem_response_line orl on orl.response_id = ors.id where orl.id = ql.oem_response_line_id limit 1),
         ql.unit_cost,
         case when ql.proposed_unit_price > 0 then (ql.proposed_unit_price - coalesce(ql.unit_cost,0) - coalesce(ql.freight_unit,0) - coalesce(ql.other_cost_unit,0)) / ql.proposed_unit_price * 100 else null end,
         bh.lead_time_days, coalesce(lo.outcome, bh.line_outcome), coalesce(lo.loss_reason_code, bh.loss_reason),
         (select p.name from public.partner p where p.id = lo.competitor_partner_id), lo.winning_price,
         0::numeric, bh.is_migrated, bh.is_validated,
         case when public.search_part_key(bh.part_no_norm) = v_part_key then 'exact' when bh.product_id = v_product_id then 'cross_reference' else 'possible' end
  from public.v_bid_history bh
  join public.quotation_line ql on ql.id = bh.quotation_line_id
  left join public.line_outcome lo on lo.quotation_version_id = bh.quotation_version_id and lo.requirement_line_id = bh.requirement_line_id
  where bh.requirement_line_id <> p_line_id
    and (public.search_part_key(bh.part_no_norm) = v_part_key or bh.product_id = v_product_id or bh.description ilike '%' || v_description || '%' or v_description ilike '%' || bh.description || '%')
  order by case when public.search_part_key(bh.part_no_norm) = v_part_key then 1 when bh.product_id = v_product_id then 2 else 3 end, bh.version_date desc
  limit 50;
end;
$$;

grant execute on function public.comparable_history(uuid) to authenticated;
