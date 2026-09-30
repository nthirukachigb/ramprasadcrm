-- Defence Contract CRM — Phase 2: Requirement timeline (T2.7)
-- One auditable timeline per requirement: status history, material audit
-- events, documents, approvals and clarifications. Later phases extend this by
-- replacing the view and adding union branches.
-- Idempotent. Depends on 0003, 0004, 0005 and 0006.

create or replace view public.v_requirement_timeline
with (security_invoker = true) as

-- 1. Controlled status changes
select
  sh.entity_id                            as requirement_id,
  sh.occurred_at                          as occurred_at,
  'status_change'::text                   as event_type,
  sh.actor                                as actor,
  ('Status ' || coalesce(sh.from_status, 'new') || ' -> ' || sh.to_status)::text as summary,
  jsonb_build_object(
    'from_status', sh.from_status,
    'to_status', sh.to_status,
    'reason', sh.reason,
    'approval_id', sh.approval_id
  )                                       as detail,
  'status_history'::text                  as source_table,
  sh.id::text                             as source_id
from public.status_history sh
where sh.entity_type = 'requirement'

union all

-- 2. Material audit events on the requirement header
select
  a.record_id::uuid                       as requirement_id,
  a.occurred_at                           as occurred_at,
  ('audit_' || lower(a.action))::text     as event_type,
  a.actor                                 as actor,
  (a.table_name || ' ' || lower(a.action))::text as summary,
  jsonb_build_object(
    'table', a.table_name,
    'action', a.action,
    'reason', a.reason,
    'new', a.new_data
  )                                       as detail,
  'audit_events'::text                    as source_table,
  a.id::text                              as source_id
from public.audit_events a
where a.table_name = 'requirement'
  and a.record_id ~ '^[0-9a-fA-F-]{36}$'

union all

-- 3. Material audit events on requirement lines (added, removed or re-quantified)
select
  (coalesce(a.new_data, a.old_data) ->> 'requirement_id')::uuid as requirement_id,
  a.occurred_at                           as occurred_at,
  ('line_' || lower(a.action))::text      as event_type,
  a.actor                                 as actor,
  ('Line ' || coalesce(
    (select rl.line_no::text from public.requirement_line rl
      where rl.id::text = a.record_id),
    (coalesce(a.new_data, a.old_data) ->> 'line_no'),
    '?'
  ) || ' ' || lower(a.action))::text      as summary,
  jsonb_build_object(
    'table', a.table_name,
    'action', a.action,
    'new', a.new_data,
    'old', a.old_data
  )                                       as detail,
  'audit_events'::text                    as source_table,
  a.id::text                              as source_id
from public.audit_events a
where a.table_name = 'requirement_line'
  and coalesce(a.new_data, a.old_data) ->> 'requirement_id' is not null
  and (
    a.action in ('INSERT', 'DELETE', 'TRUNCATE')
    or (a.old_data ->> 'quantity_required') is distinct from (a.new_data ->> 'quantity_required')
  )

union all

-- 4. Documents linked to the requirement or its lines
select
  case
    when dl.entity_type = 'requirement' then dl.entity_id
    else (select rl.requirement_id from public.requirement_line rl where rl.id = dl.entity_id)
  end                                     as requirement_id,
  dv.created_at                           as occurred_at,
  'document'::text                        as event_type,
  dv.uploaded_by                          as actor,
  ('Document attached: ' || d.title)::text as summary,
  jsonb_build_object(
    'document_id', d.id,
    'title', d.title,
    'document_type', d.document_type,
    'file_name', dv.file_name,
    'scan_status', dv.scan_status,
    'linked_to', dl.entity_type
  )                                       as detail,
  'document_version'::text                as source_table,
  dv.id::text                             as source_id
from public.document_link dl
join public.document d on d.id = dl.document_id
join lateral (
  select * from public.document_version v
  where v.document_id = d.id
  order by v.version_no desc
  limit 1
) dv on true
where dl.entity_type in ('requirement', 'requirement_line')

union all

-- 5. Approval requests and decisions
select
  ap.subject_id                           as requirement_id,
  coalesce(ap.decided_at, ap.requested_at) as occurred_at,
  'approval'::text                        as event_type,
  coalesce(ap.approver_id, ap.requested_by) as actor,
  ('Approval ' || ap.decision || ' (' || ap.subject_type || ')')::text as summary,
  jsonb_build_object(
    'approval_id', ap.id,
    'decision', ap.decision,
    'reason', ap.reason,
    'comment', ap.comment,
    'requested_by', ap.requested_by,
    'approver_id', ap.approver_id
  )                                       as detail,
  'approval'::text                        as source_table,
  ap.id::text                             as source_id
from public.approval ap
where ap.subject_type = 'requirement'

union all

-- 6. Clarifications
select
  c.requirement_id                        as requirement_id,
  coalesce(c.updated_at, c.created_at)    as occurred_at,
  'clarification'::text                   as event_type,
  c.created_by                            as actor,
  ('Clarification: ' || c.subject || ' (' || c.status || ')')::text as summary,
  jsonb_build_object(
    'clarification_id', c.id,
    'type', c.clarification_type,
    'status', c.status,
    'detail', c.detail,
    'response', c.response_text,
    'due_date', c.due_date
  )                                       as detail,
  'clarification'::text                   as source_table,
  c.id::text                              as source_id
from public.clarification c;

grant select on public.v_requirement_timeline to authenticated;
