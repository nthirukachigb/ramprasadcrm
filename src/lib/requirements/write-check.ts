import type { AppRole } from "@/lib/auth/roles";

export const REQUIREMENT_WRITE_ROLES: AppRole[] = [
  "owner",
  "sales",
  "operations",
  "admin",
];

export function canWriteRequirements(roles: AppRole[]): boolean {
  return roles.some((role) => REQUIREMENT_WRITE_ROLES.includes(role));
}
