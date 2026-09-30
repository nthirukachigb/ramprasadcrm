import { createBrowserClient } from "@supabase/ssr";

import { getPublicEnv } from "@/lib/env";

/**
 * Browser Supabase client. Uses the public anon key only; Row Level Security
 * protects all data. Never import the admin client here.
 */
export function createClient() {
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } =
    getPublicEnv();

  return createBrowserClient(
    NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
