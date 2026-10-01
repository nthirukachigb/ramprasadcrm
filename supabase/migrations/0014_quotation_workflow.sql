-- Defence Contract CRM — Phase 5: Quotation workflow (T5.2–T5.4, T5.6 DB)
-- Create-from-requirement, the approval gate, revisions and submission.
-- Idempotent. Depends on 0013_quotation.sql.

-- ---------------------------------------------------------------------------
-- 1. Columns the builder and submission record need
-- ---------------------------------------------------------------------------
alter table public.quotation_line
  alter column proposed_unit_price drop not null;
alter table public.quotation_line
  drop constraint if exists quotation_line_proposed_unit_price_check;
alter table public.quotation_line
  add constraint quotation_line_proposed_unit_price_check
  check (proposed_unit_price is null or proposed_unit_price > 0);
alter table public.quotation_line
  add column if not exists sourcing_basis text
  check (sourcing_basis is null or sourcing_basis in ('oem_selected', 'customer_supplied', 'in_house'));

alter table public.quotation_version
  add column if not exists submitted_at timestamptz;
alter table public.quotation_version
  add column if not exists submission_mode text;
alter table public.quotation_version
  add column if not exists submission_ref text;
alter table public.quotation_version
  add column if not exists late_reason text;

-- ---------------------------------------------------------------------------
-- 2. Create a quotation + first draft version from a requirement (T5.2)
-- ---------------------------------------------------------------------------
create or replace function public.create_quotation_from_requirement(
  p_requirement_id uuid,
  p_line_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quotation uuid;
  v_version uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.has_any_role(
    array['owner', 'sales', 'operations', 'admin']::public.app_role[]
  ) then
    raise exception 'FORBIDDEN: you may not create a quotation';
  end if;
  if not exists (select 1 from public.requirement where id = p_requirement_id) then
    raise exception 'Requirement not found';
  end if;

  insert into public.quotation (requirement_id, created_by, updated_by)
  values (p_requirement_id, auth.uid(), auth.uid())
  returning id into v_quotation;

  insert into public.quotation_version
    (quotation_id, version_no, version_reason, status, created_by, updated_by)
  values (v_quotation, 1, 'initial', 'draft', auth.uid(), auth.uid())
  returning id into v_version;

  update public.quotation
     set current_version_id = v_version
   where id = v_quotation;

  -- One quotation line per selected requirement line. The OEM cost is linked
  -- from any OEM response for that line; the price is set by the builder.
  insert into public.quotation_line
    (
      quotation_version_id, requirement_line_id, oem_response_line_id,
      qty_quoted, uom, unit_cost, proposed_unit_price, sort_order
    )
  select
    v_version,
    rl.id,
    cost.oem_response_line_id,
    rl.quantity_required,
    rl.uom,
    cost.unit_price,
    null,
    rl.line_no
  from public.requirement_line rl
  left join lateral (
    select ol.id as oem_response_line_id, ol.unit_price
    from public.sourcing_request_line srl
    join public.oem_response_line ol on ol.sourcing_request_line_id = srl.id
    where srl.requirement_line_id = rl.id
      and ol.unit_price is not null
    order by ol.unit_price asc
    limit 1
  ) cost on true
  where rl.requirement_id = p_requirement_id
    and (p_line_ids is null or rl.id = any (p_line_ids));

  return v_version;
end;
$$;

grant execute on function public.create_quotation_from_requirement(uuid, uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Approval gate (T5.3, FR-QUOTE-06, FR-QTY-04, FR-RFI-05, FR-SOURCE-05)
-- ---------------------------------------------------------------------------
create or replace function public.quotation_gate_errors(p_version_id uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_req uuid;
  v_errors text[] := '{}';
  v_n integer;
begin
  select q.requirement_id into v_req
  from public.quotation_version qv
  join public.quotation q on q.id = qv.quotation_id
  where qv.id = p_version_id;

  if v_req is null then
    raise exception 'Quotation version not found';
  end if;

  select count(*) into v_n
  from public.v_requirement_line_coverage c
  where c.requirement_id = v_req
    and c.qty_uncovered > 0
    and not c.has_approved_override;
  if v_n > 0 then
    v_errors := v_errors || format(
      'FR-QTY-04: %s line(s) have uncovered quantity without an approved override', v_n);
  end if;

  select count(*) into v_n
  from public.checklist_item ci
  where ci.requirement_id = v_req
    and ci.is_mandatory
    and ci.status not in ('attached', 'waived');
  if v_n > 0 then
    v_errors := v_errors || format(
      'FR-RFI-05: %s mandatory checklist item(s) are open', v_n);
  end if;

  select count(*) into v_n
  from public.quotation_line ql
  where ql.quotation_version_id = p_version_id
    and ql.proposed_unit_price is null;
  if v_n > 0 then
    v_errors := v_errors || format(
      'FR-QUOTE-03: %s line(s) have no proposed price', v_n);
  end if;

  select count(*) into v_n
  from public.quotation_line ql
  where ql.quotation_version_id = p_version_id
    and ql.sourcing_basis is null;
  if v_n > 0 then
    v_errors := v_errors || format(
      'FR-SOURCE-05: %s line(s) have no sourcing basis (OEM / customer-supplied / in-house)', v_n);
  end if;

  select count(*) into v_n
  from public.quotation_line ql
  where ql.quotation_version_id = p_version_id
    and ql.sourcing_basis = 'oem_selected'
    and not exists (
      select 1 from public.oem_selection s
      where s.requirement_line_id = ql.requirement_line_id
        and s.status = 'approved'
    );
  if v_n > 0 then
    v_errors := v_errors || format(
      'FR-SOURCE-05: %s line(s) have no approved OEM selection', v_n);
  end if;

  select count(*) into v_n
  from public.quotation_line ql
  where ql.quotation_version_id = p_version_id
    and ql.sourcing_basis = 'oem_selected'
    and ql.unit_cost is null;
  if v_n > 0 then
    v_errors := v_errors || format(
      'FR-QUOTE-03: %s OEM-selected line(s) have no OEM cost', v_n);
  end if;

  return v_errors;
end;
$$;

grant execute on function public.quotation_gate_errors(uuid) to authenticated;

create or replace function public.submit_quote_for_approval(p_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.quotation_status;
  v_errors text[];
  v_approval uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.has_any_role(
    array['owner', 'sales', 'operations', 'admin']::public.app_role[]
  ) then
    raise exception 'FORBIDDEN: you may not submit a quotation';
  end if;

  select status into v_status from public.quotation_version where id = p_version_id;
  if v_status is null then
    raise exception 'Quotation version not found';
  end if;
  if v_status <> 'draft' then
    raise exception 'Only a draft version can be submitted for approval';
  end if;

  v_errors := public.quotation_gate_errors(p_version_id);
  if array_length(v_errors, 1) is not null then
    raise exception 'QUOTE_GATE: %', array_to_string(v_errors, ' | ');
  end if;

  v_approval := public.request_approval(
    'quotation_version', p_version_id, 'Quotation approval requested');

  update public.quotation_version
     set status = 'pending_approval', approval_id = v_approval, updated_at = now()
   where id = p_version_id;

  return v_approval;
end;
$$;

grant execute on function public.submit_quote_for_approval(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Owner approval (T5.3) — locks the version and makes it current
-- ---------------------------------------------------------------------------
create or replace function public.approve_quotation_version(
  p_version_id uuid,
  p_comment text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version public.quotation_version;
  v_req uuid;
  v_errors text[];
  v_totals jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.has_any_role(array['owner', 'admin']::public.app_role[]) then
    raise exception 'FORBIDDEN: only the Owner or Admin may approve a quotation';
  end if;
  if p_comment is null or length(btrim(p_comment)) < 3 then
    raise exception 'An approval comment of at least 3 characters is required';
  end if;

  select * into v_version from public.quotation_version where id = p_version_id for update;
  if not found then
    raise exception 'Quotation version not found';
  end if;
  if v_version.status <> 'pending_approval' then
    raise exception 'Only a version pending approval can be approved';
  end if;

  v_errors := public.quotation_gate_errors(p_version_id);
  if array_length(v_errors, 1) is not null then
    raise exception 'QUOTE_GATE: %', array_to_string(v_errors, ' | ');
  end if;

  select q.requirement_id into v_req
  from public.quotation q where q.id = v_version.quotation_id;

  select to_jsonb(t) into v_totals
  from public.v_quotation_totals t
  where t.quotation_version_id = p_version_id;

  perform set_config('app.quotation_unlocked', 'on', true);

  -- Only one current version (PRD §21.5).
  update public.quotation_version
     set status = 'superseded', updated_at = now()
   where quotation_id = v_version.quotation_id
     and id <> p_version_id
     and status in ('approved', 'submitted');

  update public.quotation_version
     set status = 'approved',
         approved_by = auth.uid(),
         approved_at = now(),
         snapshot = v_totals,
         notes = coalesce(notes, '') || case when notes is null then '' else E'\n' end
                 || 'Approved: ' || p_comment,
         updated_at = now()
   where id = p_version_id;

  update public.quotation
     set current_version_id = p_version_id, updated_at = now()
   where id = v_version.quotation_id;

  if v_version.approval_id is not null then
    if exists (
      select 1 from public.approval
      where id = v_version.approval_id and decision = 'pending'
    ) then
      perform public.decide_approval(v_version.approval_id, 'approved', p_comment);
    end if;
  end if;

  -- An approved quotation moves an in-preparation requirement to Quoted.
  if exists (
    select 1 from public.requirement
    where id = v_req and status = 'in_preparation'
  ) then
    perform public.transition_requirement(v_req, 'quoted', 'Quotation approved');
  end if;
end;
$$;

grant execute on function public.approve_quotation_version(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Revisions (T5.4)
-- ---------------------------------------------------------------------------
create or replace function public.create_revision(
  p_version_id uuid,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src public.quotation_version;
  v_new uuid;
  v_reason public.quotation_version_reason;
  v_next integer;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.has_any_role(
    array['owner', 'sales', 'operations', 'admin']::public.app_role[]
  ) then
    raise exception 'FORBIDDEN: you may not create a revision';
  end if;

  begin
    v_reason := p_reason::public.quotation_version_reason;
  exception when others then
    raise exception 'Invalid revision reason';
  end;

  select * into v_src from public.quotation_version where id = p_version_id;
  if not found then
    raise exception 'Quotation version not found';
  end if;
  if v_src.status not in ('approved', 'submitted', 'rejected', 'pending_approval') then
    raise exception 'A revision is created from an approved, submitted or rejected version';
  end if;

  select coalesce(max(version_no), 0) + 1 into v_next
  from public.quotation_version where quotation_id = v_src.quotation_id;

  insert into public.quotation_version
    (quotation_id, version_no, version_reason, status, currency, fx_rate, valid_until,
     delivery_terms, payment_terms, created_by, updated_by)
  values
    (v_src.quotation_id, v_next, v_reason, 'draft', v_src.currency, v_src.fx_rate,
     v_src.valid_until, v_src.delivery_terms, v_src.payment_terms, auth.uid(), auth.uid())
  returning id into v_new;

  insert into public.quotation_line
    (quotation_version_id, requirement_line_id, oem_response_line_id, qty_quoted, uom,
     unit_cost, freight_unit, other_cost_unit, target_margin_pct, proposed_unit_price,
     lead_time_days, sourcing_basis, notes, sort_order)
  select
    v_new, requirement_line_id, oem_response_line_id, qty_quoted, uom,
    unit_cost, freight_unit, other_cost_unit, target_margin_pct, proposed_unit_price,
    lead_time_days, sourcing_basis, notes, sort_order
  from public.quotation_line
  where quotation_version_id = p_version_id;

  update public.quotation
     set current_version_id = v_new, updated_at = now()
   where id = v_src.quotation_id;

  return v_new;
end;
$$;

grant execute on function public.create_revision(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Submission record (T5.6)
-- ---------------------------------------------------------------------------
create or replace function public.record_quotation_submission(
  p_version_id uuid,
  p_mode text,
  p_at timestamptz,
  p_ref text,
  p_proof_document_id uuid,
  p_late_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version public.quotation_version;
  v_req uuid;
  v_deadline timestamptz;
  v_status public.requirement_status;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.has_any_role(
    array['owner', 'sales', 'operations', 'admin']::public.app_role[]
  ) then
    raise exception 'FORBIDDEN: you may not record a submission';
  end if;

  select * into v_version from public.quotation_version where id = p_version_id for update;
  if not found then
    raise exception 'Quotation version not found';
  end if;
  if v_version.status <> 'approved' then
    raise exception 'Only an approved version can be submitted (FR-QUOTE-06)';
  end if;

  select requirement_id into v_req from public.quotation where id = v_version.quotation_id;
  select submission_deadline, status into v_deadline, v_status
  from public.requirement where id = v_req;

  if v_deadline is not null
     and p_at > v_deadline
     and (p_late_reason is null or length(btrim(p_late_reason)) < 3) then
    raise exception 'FR-QUOTE-07: a late submission needs a reason';
  end if;

  perform set_config('app.quotation_unlocked', 'on', true);
  update public.quotation_version
     set status = 'submitted',
         submitted_at = p_at,
         submission_mode = p_mode,
         submission_ref = p_ref,
         late_reason = p_late_reason,
         updated_at = now()
   where id = p_version_id;

  if p_proof_document_id is not null then
    insert into public.document_link (document_id, entity_type, entity_id, linked_by)
    values (p_proof_document_id, 'quotation', p_version_id, auth.uid())
    on conflict (document_id, entity_type, entity_id) do nothing;
  end if;

  if v_status = 'quoted' then
    perform public.transition_requirement(v_req, 'submitted', 'Quotation submitted');
  end if;
end;
$$;

grant execute on function public.record_quotation_submission(uuid, text, timestamptz, text, uuid, text) to authenticated;
