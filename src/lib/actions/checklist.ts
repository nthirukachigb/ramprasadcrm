"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser, type AppRole } from "@/lib/auth/get-user";
import { friendlyError } from "@/lib/actions/errors";
import { createClient } from "@/lib/supabase/server";

const WRITE_ROLES: AppRole[] = ["owner", "sales", "operations", "admin"];

export type ChecklistResult =
  | { ok: true }
  | { ok: false; error: string };

export async function setChecklistItemStatus(input: {
  id: string;
  requirementId: string;
  status: "required" | "prepared" | "attached";
  documentId?: string | null;
}): Promise<ChecklistResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (!user.roles.some((role) => WRITE_ROLES.includes(role))) {
    return { ok: false, error: "You do not have permission to edit the checklist." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("checklist_item")
    .update({ status: input.status, document_id: input.documentId ?? null })
    .eq("id", input.id);
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };

  revalidatePath(`/requirements/${input.requirementId}`);
  return { ok: true };
}

/**
 * Request an Owner waiver for a checklist item. The item becomes Waived only
 * when the Owner approves the request (see lib/actions/approvals.ts).
 */
export async function requestChecklistWaiver(input: {
  itemId: string;
  requirementId: string;
  reason: string;
}): Promise<ChecklistResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (!user.roles.some((role) => WRITE_ROLES.includes(role))) {
    return { ok: false, error: "You do not have permission to request a waiver." };
  }
  if (input.reason.trim().length < 3) {
    return { ok: false, error: "A waiver reason is required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("request_approval", {
    p_subject_type: "checklist_item",
    p_subject_id: input.itemId,
    p_reason: input.reason,
  });
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };

  revalidatePath(`/requirements/${input.requirementId}`);
  revalidatePath("/approvals");
  return { ok: true };
}
