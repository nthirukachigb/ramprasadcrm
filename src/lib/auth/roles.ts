/**
 * Pure authorisation types and helpers with no Supabase or Next.js imports, so
 * they are trivial to unit test.
 */

export type AppRole = "owner" | "sales" | "operations" | "finance" | "admin";

export interface CurrentUser {
  id: string;
  email: string | null;
  fullName: string | null;
  roles: AppRole[];
}

export class ForbiddenError extends Error {
  constructor(message = "You do not have access to this resource.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function hasAnyRole(
  user: { roles: AppRole[] } | null | undefined,
  roles: AppRole[],
): boolean {
  if (!user) return false;
  if (roles.length === 0) return true;
  return roles.some((role) => user.roles.includes(role));
}

/** Throws ForbiddenError when the user is missing or lacks a required role. */
export function assertHasRole(
  user: CurrentUser | null,
  roles: AppRole[],
): CurrentUser {
  if (!user || !hasAnyRole(user, roles)) {
    throw new ForbiddenError();
  }
  return user;
}
