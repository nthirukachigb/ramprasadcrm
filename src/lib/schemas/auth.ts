import { z } from "zod";

export const loginSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const DEMO_ROLES = [
  "owner",
  "sales",
  "operations",
  "finance",
  "admin",
] as const;

export type DemoRole = (typeof DEMO_ROLES)[number];

export const demoSignInSchema = z.object({
  role: z.enum(DEMO_ROLES),
});

export const DEMO_USER_EMAILS: Record<DemoRole, string> = {
  owner: "owner@demo.local",
  sales: "sales@demo.local",
  operations: "operations@demo.local",
  finance: "finance@demo.local",
  admin: "admin@demo.local",
};
