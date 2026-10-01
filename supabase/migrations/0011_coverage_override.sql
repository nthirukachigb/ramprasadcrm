-- Defence Contract CRM — Phase 4: Coverage override with owner approval (T4.2)
-- A controlled, audited exception for uncovered quantity (FR-QTY-05, BR-11).
-- Idempotent. Depends on 0010_coverage.sql and the approval framework (0003).

-- ---------------------------------------------------------------------------
-- 1. Request an override (creates the approval request)
-- ---------------------------------------------------------------------------
create or replace function public.request_coverage_override(
  p_requirement_line_id uuid,
  p_gap_qty numeric,
  p_reason text,
  p_risk text default null,
  p_mitigation text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_approval uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if not public.has_any_role(
    array['owner', 'sales', 'operations', 'admin']::public.app_role[]
  ) then
    raise exception 'FORBIDDEN: you may not request a coverage override';
  end if;
  if p_gap_qty is null or p_gap_qty <= 0 then
    raise exception 'The uncovered quantity must be greater than zero';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'A reason of at least 3 characters is required';
  end if;

  insert into public.coverage_override
    (requirement_line_id, gap_qty, reason, risk, mitigation, status)
  values
    (p_requirement_line_id, p_gap_qty, p_reason, p_risk, p_mitigation, 'requested')
  returning id into v_id;

  v_approval := public.request_approval('coverage_override', v_id, p_reason);

  update public.coverage_override
     set approval_id = v_approval, updated_at = now()
   where id = v_id;

  return v_id;
end;
$$;

grant execute on function public.request_coverage_override(uuid, numeric, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. An approved override is resolved automatically once commitments close it
-- ---------------------------------------------------------------------------
create or replace function public.resolve_coverage_overrides()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_required numeric;
  v_committed numeric;
begin
  select quantity_required into v_required
  from public.requirement_line
  where id = new.requirement_line_id;

  if v_required is null then
    return new;
  end if;

  v_committed := public.committed_qty(new.requirement_line_id, current_date);

  if v_committed >= v_required then
    update public.coverage_override
       set status = 'resolved', updated_at = now()
     where requirement_line_id = new.requirement_line_id
       and status = 'approved';
  end if;

  return new;
end;
$$;

drop trigger if exists quantity_commitment_resolve_overrides on public.quantity_commitment;
create trigger quantity_commitment_resolve_overrides
  after insert or update on public.quantity_commitment
  for each row execute function public.resolve_coverage_overrides();
