import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getPublicEnv } from "@/lib/env";

/**
 * User-scoped Supabase client for Server Components, Server Actions and Route
 * Handlers. Reads the session from cookies, so Row Level Security applies to
 * every query under the signed-in user.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } =
    getPublicEnv();

  return createServerClient(
    NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Called from a Server Component where cookies are read-only.
            // Session refresh is handled by proxy.ts, so this is safe to ignore.
          }
        },
      },
    },
  );
}
