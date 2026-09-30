"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser } from "@/lib/auth/get-user";
import { friendlyError } from "@/lib/actions/errors";
import { createClient } from "@/lib/supabase/server";

export type ApprovalActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

export async function requestApproval(input: {
  subjectType: string;
  subjectId: string;
  reason: string;
}): Promise<ApprovalActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_approval", {
    p_subject_type: input.subjectType,
    p_subject_id: input.subjectId,
    p_reason: input.reason,
  });
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };

  revalidatePath("/approvals");
  return { ok: true, id: data as string };
}

export async function decideApproval(input: {
  approvalId: string;
  decision: "approved" | "rejected";
  comment: string;
}): Promise<ApprovalActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };

  const supabase = await createClient();

  const { data: approval, error: readError } = await supabase
    .from("approval")
    .select("id, subject_type, subject_id, reason, decision")
    .eq("id", input.approvalId)
    .single();
  if (readError || !approval) {
    return { ok: false, error: "Approval not found." };
  }

  const { error } = await supabase.rpc("decide_approval", {
    p_approval_id: input.approvalId,
    p_decision: input.decision,
    p_comment: input.comment,
  });
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };

  // A pass approval on a requirement performs the controlled transition.
  if (approval.subject_type === "requirement" && input.decision === "approved") {
    const { error: transitionError } = await supabase.rpc(
      "transition_requirement",
      {
        p_id: approval.subject_id,
        p_to_status: "not_pursued",
        p_reason: approval.reason ?? input.comment,
      },
    );
    if (transitionError) {
      return {
        ok: false,
        error: friendlyError(transitionError.message, transitionError.code),
      };
    }
    revalidatePath(`/requirements/${approval.subject_id}`);
  }

  // An approved checklist waiver marks the item waived and stores the approval.
  if (approval.subject_type === "checklist_item" && input.decision === "approved") {
    const { error: waiveError } = await supabase
      .from("checklist_item")
      .update({ status: "waived", waiver_approval_id: approval.id })
      .eq("id", approval.subject_id);
    if (waiveError) {
      return { ok: false, error: "Could not record the waiver." };
    }
  }

  // OEM selection: approval gates the selection status (T3.5).
  if (approval.subject_type === "oem_selection") {
    const nextStatus = input.decision === "approved" ? "approved" : "rejected";
    const { error: selectionError } = await supabase
      .from("oem_selection")
      .update({ status: nextStatus })
      .eq("id", approval.subject_id);
    if (selectionError) {
      return { ok: false, error: "Could not update the OEM selection." };
    }
  }



  revalidatePath("/approvals");
  revalidatePath("/dashboard");
  return { ok: true, id: input.approvalId };
}
