import { z } from "zod";

export const ROLE_VALUES = [
  "owner",
  "sales",
  "operations",
  "finance",
  "admin",
] as const;

export const setUserRoleSchema = z.object({
  userId: z.string().uuid("A valid user id is required"),
  role: z.enum(ROLE_VALUES),
  action: z.enum(["add", "remove"]),
  reason: z
    .string()
    .trim()
    .min(3, "Please give a reason of at least 3 characters")
    .max(500, "Reason is too long"),
});

export type SetUserRoleInput = z.infer<typeof setUserRoleSchema>;
