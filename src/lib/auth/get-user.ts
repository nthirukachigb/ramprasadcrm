import { redirect } from "next/navigation";

import {
  assertHasRole,
  hasAnyRole,
  type AppRole,
  type CurrentUser,
} from "@/lib/auth/roles";
import { createClient } from "@/lib/supabase/server";

export {
  assertHasRole,
  ForbiddenError,
  hasAnyRole,
  type AppRole,
  type CurrentUser,
} from "@/lib/auth/roles";

/** Returns the signed-in user with their roles, or null when signed out. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) {
      console.warn("Supabase auth lookup failed; treating session as signed out.", error.message);
      return null;
    }
    if (!user) return null;

    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);

    const roles = (roleRows ?? []).map((row) => row.role as AppRole);

    return {
      id: user.id,
      email: user.email ?? null,
      fullName:
        (user.user_metadata?.full_name as string | undefined) ??
        user.email ??
        null,
      roles,
    };
  } catch (error) {
    console.warn(
      "Supabase auth is unavailable; treating the user as signed out.",
      error,
    );
    return null;
  }
}

/** Redirects to /login when signed out. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * For Server Components and Server Actions: redirects to /login when signed
 * out, and throws ForbiddenError when the user lacks one of the roles.
 */
export async function requireRole(roles: AppRole[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return assertHasRole(user, roles);
}

/** For Server Components that should render a friendly page, not an error. */
export async function requireRoleOrRedirect(
  roles: AppRole[],
  redirectTo = "/dashboard",
): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasAnyRole(user, roles)) redirect(redirectTo);
  return user;
}
