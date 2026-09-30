"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/get-user";
import { setUserRoleSchema } from "@/lib/schemas/admin";
import { createClient } from "@/lib/supabase/server";

export type ActionResult = { ok: true } | { ok: false; error: string };

function friendly(message: string): string {
  if (message.includes("FORBIDDEN")) {
    return "Only an administrator can change roles.";
  }
  if (message.includes("reason")) {
    return "A reason of at least 3 characters is required.";
  }
  return "Could not update the role. Please try again.";
}

export async function setUserRole(input: unknown): Promise<ActionResult> {
  const parsed = setUserRoleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const currentUser = await getCurrentUser();
  if (!currentUser || !currentUser.roles.includes("admin")) {
    return { ok: false, error: "Only an administrator can change roles." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_user_role", {
    p_user_id: parsed.data.userId,
    p_role: parsed.data.role,
    p_action: parsed.data.action,
    p_reason: parsed.data.reason,
  });

  if (error) {
    return { ok: false, error: friendly(error.message) };
  }

  revalidatePath("/admin/users");
  revalidatePath("/admin/audit");
  return { ok: true };
}
