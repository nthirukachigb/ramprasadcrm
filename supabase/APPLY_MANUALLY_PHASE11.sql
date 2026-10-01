-- Defence Contract CRM — Phase 11 manual application
--
-- Preferred path (Supabase CLI):
--   supabase db push
-- The CLI applies supabase/migrations/0033_phase11_search.sql automatically.
--
-- SQL Editor path:
--   Open supabase/migrations/0033_phase11_search.sql, copy its complete
--   contents into the Supabase SQL Editor, and run it once.
--
-- IMPORTANT:
-- Supabase SQL Editor cannot include another file. Apply the migration by
-- opening supabase/migrations/0033_phase11_search.sql and running its complete
-- contents first. The queries below are SQL-only smoke checks and can then be
-- run from this file without the psql-only \set / \ir commands.

-- Smoke checks (run after the migration):
select to_regclass('public.search_document') as search_index_table;
select count(*) as indexed_records from public.search_document;
select proname, n.nspname as schema_name
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where (n.nspname = 'public' and proname in ('search', 'search_suggestions'))
   or (n.nspname = 'app' and proname = 'search')
order by schema_name, proname;
