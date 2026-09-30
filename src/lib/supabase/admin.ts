import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { requireServerVar, getPublicEnv } from "@/lib/env";

/**
 * Service-role client. Bypasses Row Level Security, so it must only be used in
 * server-only code (seed scripts, trusted admin operations) after an explicit
 * permission check. It is marked `server-only`: importing it from a Client
 * Component will fail the build.
 */
export function createAdminClient() {
  const { NEXT_PUBLIC_SUPABASE_URL } = getPublicEnv();
  const serviceRoleKey = requireServerVar("SUPABASE_SERVICE_ROLE_KEY");

  return createSupabaseClient(NEXT_PUBLIC_SUPABASE_URL, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
