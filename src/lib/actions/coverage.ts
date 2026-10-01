"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser, type AppRole } from "@/lib/auth/get-user";
import { friendlyError } from "@/lib/actions/errors";
import { createClient } from "@/lib/supabase/server";

const WRITE_ROLES: AppRole[] = ["owner", "sales", "operations", "admin"];

export type CoverageResult = { ok: true; id?: string } | { ok: false; error: string };

export async function requestCoverageOverride(input: {
  requirementId: string;
  requirementLineId: string;
  gapQty: number;
  reason: string;
  risk?: string;
  mitigation?: string;
}): Promise<CoverageResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (!user.roles.some((role) => WRITE_ROLES.includes(role))) {
    return { ok: false, error: "You do not have permission to request an override." };
  }
  if (!(input.gapQty > 0)) {
    return { ok: false, error: "The uncovered quantity must be greater than zero." };
  }
  if (input.reason.trim().length < 3) {
    return { ok: false, error: "A reason is required." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_coverage_override", {
    p_requirement_line_id: input.requirementLineId,
    p_gap_qty: input.gapQty,
    p_reason: input.reason,
    p_risk: input.risk ?? null,
    p_mitigation: input.mitigation ?? null,
  });
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };

  revalidatePath(`/requirements/${input.requirementId}/coverage`);
  revalidatePath(`/requirements/${input.requirementId}`);
  revalidatePath("/approvals");
  revalidatePath("/dashboard");
  return { ok: true, id: data as string };
}
