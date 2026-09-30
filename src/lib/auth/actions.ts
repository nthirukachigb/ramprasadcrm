"use server";

import { redirect } from "next/navigation";

import { getServerEnv, requireServerVar } from "@/lib/env";
import {
  DEMO_USER_EMAILS,
  demoSignInSchema,
  loginSchema,
} from "@/lib/schemas/auth";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function signInWithEmail(input: unknown): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Enter a valid email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Deliberately generic: never reveal whether the email exists.
    return { ok: false, error: "Email or password not recognised." };
  }
  return { ok: true };
}

/**
 * Demo sign-in. The password lives only in the server environment and is never
 * sent to the browser. Disabled unless DEMO_MODE is enabled.
 */
export async function signInAsDemo(input: unknown): Promise<ActionResult> {
  const env = getServerEnv();
  if (!env.DEMO_MODE) {
    return { ok: false, error: "Demo sign-in is not available." };
  }

  const parsed = demoSignInSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Unknown demo role." };
  }

  const password = requireServerVar("DEMO_USER_PASSWORD");
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: DEMO_USER_EMAILS[parsed.data.role],
    password,
  });

  if (error) {
    return {
      ok: false,
      error: "Demo sign-in failed. Make sure demo users are seeded.",
    };
  }
  return { ok: true };
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
