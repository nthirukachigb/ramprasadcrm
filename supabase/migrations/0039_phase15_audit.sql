-- Phase 15 / T15.1: permission-safe audit review projection.
-- The view remains append-only because its source table is append-only.
create or replace view public.v_audit_event
with (security_invoker = true)
as
select
  a.id,
  a.table_name,
  a.record_id,
  a.action,
  a.actor,
  coalesce(p.full_name, p.email, a.actor::text) as actor_name,
  a.occurred_at,
  a.old_data,
  a.new_data,
  a.reason
from public.audit_events as a
left join public.profiles as p on p.id = a.actor;

grant select on public.v_audit_event to authenticated;