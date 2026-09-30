"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser, type AppRole } from "@/lib/auth/get-user";
import { friendlyError } from "@/lib/actions/errors";
import { createClient } from "@/lib/supabase/server";
import {
  commitmentChangeSchema,
  commitmentWithdrawSchema,
  confirmShortlistSchema,
  oemResponseSchema,
  selectionSchema,
  sourcingRequestSchema,
  type SourcingRequestStatus,
} from "@/lib/schemas/sourcing";

const WRITE_ROLES: AppRole[] = ["owner", "sales", "operations", "admin"];

export type SourcingResult<T = undefined> =
  | { ok: true; id?: string; data?: T }
  | { ok: false; error: string };

async function guard(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (!user.roles.some((role) => WRITE_ROLES.includes(role))) {
    return { ok: false, error: "You do not have permission to manage sourcing." };
  }
  return { ok: true, userId: user.id };
}

function revalidate(requirementId: string) {
  revalidatePath(`/requirements/${requirementId}`);
  revalidatePath(`/requirements/${requirementId}/sourcing`);
  revalidatePath("/dashboard");
}

// ---------------------------------------------------------------------------
// T3.2 — shortlist
// ---------------------------------------------------------------------------
export async function confirmShortlist(
  input: unknown,
): Promise<SourcingResult> {
  const g = await guard();
  if (!g.ok) return g;
  const parsed = confirmShortlistSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid selection" };
  }

  const rows = parsed.data.selections.flatMap((selection) =>
    selection.partnerIds.map((partnerId) => ({
      requirement_id: parsed.data.requirementId,
      requirement_line_id: selection.requirementLineId,
      partner_id: partnerId,
      suggestion_source: "system",
      confirmed_by: g.userId,
      confirmed_at: new Date().toISOString(),
    })),
  );
  if (rows.length === 0) return { ok: false, error: "Select at least one partner." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("sourcing_shortlist")
    .upsert(rows, { onConflict: "requirement_line_id,partner_id", ignoreDuplicates: true });
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };

  revalidate(parsed.data.requirementId);
  return { ok: true };
}

export async function removeShortlistEntry(input: {
  id: string;
  requirementId: string;
}): Promise<SourcingResult> {
  const g = await guard();
  if (!g.ok) return g;
  const supabase = await createClient();
  const { error } = await supabase.from("sourcing_shortlist").delete().eq("id", input.id);
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };
  revalidate(input.requirementId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// T3.3 — requests and responses
// ---------------------------------------------------------------------------
export async function createSourcingRequest(
  input: unknown,
): Promise<SourcingResult> {
  const g = await guard();
  if (!g.ok) return g;
  const parsed = sourcingRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid request" };
  }
  const supabase = await createClient();

  const { data: lines } = await supabase
    .from("requirement_line")
    .select("id, quantity_required")
    .in("id", parsed.data.lineIds)
    .eq("requirement_id", parsed.data.requirementId);
  if (!lines || lines.length === 0) {
    return { ok: false, error: "Select at least one valid line." };
  }

  const { data: request, error } = await supabase
    .from("sourcing_request")
    .insert({
      requirement_id: parsed.data.requirementId,
      partner_id: parsed.data.partnerId,
      response_due_date: parsed.data.responseDueDate ?? null,
      channel: parsed.data.channel ?? null,
      status: parsed.data.markSent ? "sent" : "draft",
      sent_by: parsed.data.markSent ? g.userId : null,
      created_by: g.userId,
      updated_by: g.userId,
    })
    .select("id")
    .single();
  if (error || !request) return { ok: false, error: friendlyError(error?.message ?? "", error?.code) };

  const { error: lineError } = await supabase.from("sourcing_request_line").insert(
    lines.map((line) => ({
      request_id: request.id,
      requirement_line_id: line.id,
      qty_requested: line.quantity_required,
    })),
  );
  if (lineError) return { ok: false, error: friendlyError(lineError.message, lineError.code) };

  revalidate(parsed.data.requirementId);
  return { ok: true, id: request.id };
}

export async function setSourcingRequestStatus(input: {
  id: string;
  requirementId: string;
  status: SourcingRequestStatus;
}): Promise<SourcingResult> {
  const g = await guard();
  if (!g.ok) return g;
  const supabase = await createClient();
  const { error } = await supabase
    .from("sourcing_request")
    .update({ status: input.status })
    .eq("id", input.id);
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };
  revalidate(input.requirementId);
  return { ok: true };
}

export async function createOemResponse(
  input: unknown,
): Promise<SourcingResult> {
  const g = await guard();
  if (!g.ok) return g;
  const parsed = oemResponseSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid response" };
  }
  const supabase = await createClient();

  const { data: response, error } = await supabase
    .from("oem_response")
    .insert({
      request_id: parsed.data.requestId,
      partner_id: parsed.data.partnerId,
      response_date: parsed.data.responseDate,
      partner_quotation_no: parsed.data.partnerQuotationNo ?? null,
      status: "received",
      received_by: g.userId,
      notes: parsed.data.notes ?? null,
      created_by: g.userId,
      updated_by: g.userId,
    })
    .select("id")
    .single();
  if (error || !response) return { ok: false, error: friendlyError(error?.message ?? "", error?.code) };

  for (const line of parsed.data.lines) {
    const { data: responseLine, error: lineError } = await supabase
      .from("oem_response_line")
      .insert({
        response_id: response.id,
        sourcing_request_line_id: line.sourcingRequestLineId,
        unit_price: line.unitPrice ?? null,
        lead_time_days: line.leadTimeDays ?? null,
        moq: line.moq ?? null,
        validity_until: line.validityUntil ?? null,
      })
      .select("id, sourcing_request_line:sourcing_request_line_id(requirement_line_id)")
      .single();
    if (lineError || !responseLine) {
      return { ok: false, error: friendlyError(lineError?.message ?? "", lineError?.code) };
    }

    // Availability is informational only and kept separate from commitment.
    if (line.availability !== undefined && line.availability > 0) {
      await supabase.from("quantity_indication").insert({
        response_line_id: responseLine.id,
        qty_available_indicated: line.availability,
      });
    }

    // A firm commitment requires evidence (note) and is versioned.
    if (line.commitmentQty !== undefined && line.commitmentQty > 0) {
      const requirementLineId = (
        responseLine.sourcing_request_line as unknown as { requirement_line_id: string } | null
      )?.requirement_line_id;
      if (!requirementLineId) {
        return { ok: false, error: "Could not resolve the requirement line." };
      }
      const { error: commitmentError } = await supabase
        .from("quantity_commitment")
        .insert({
          requirement_line_id: requirementLineId,
          partner_id: parsed.data.partnerId,
          response_line_id: responseLine.id,
          qty_committed: line.commitmentQty,
          evidence_note: line.commitmentNote ?? null,
          created_by: g.userId,
          updated_by: g.userId,
        });
      if (commitmentError) {
        return { ok: false, error: friendlyError(commitmentError.message, commitmentError.code) };
      }
    }
  }

  // Mark the request responded (partially if not every line came back).
  const { count } = await supabase
    .from("sourcing_request_line")
    .select("id", { count: "exact", head: true })
    .eq("request_id", parsed.data.requestId);
  const answered = parsed.data.lines.length;
  await supabase
    .from("sourcing_request")
    .update({
      status: (count ?? 0) > answered ? "partially_responded" : "responded",
    })
    .eq("id", parsed.data.requestId);

  revalidate(
    (
      await supabase
        .from("sourcing_request")
        .select("requirement_id")
        .eq("id", parsed.data.requestId)
        .single()
    ).data?.requirement_id ?? "",
  );
  return { ok: true, id: response.id };
}

// ---------------------------------------------------------------------------
// T3.4 — commitment change and withdrawal
// ---------------------------------------------------------------------------
export async function changeCommitment(
  input: unknown,
): Promise<SourcingResult> {
  const g = await guard();
  if (!g.ok) return g;
  const parsed = commitmentChangeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid change" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("change_commitment", {
    p_id: parsed.data.id,
    p_new_qty: parsed.data.newQty,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };
  return { ok: true, id: data as string };
}

export async function withdrawCommitment(
  input: unknown,
): Promise<SourcingResult> {
  const g = await guard();
  if (!g.ok) return g;
  const parsed = commitmentWithdrawSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid withdrawal" };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_commitment", {
    p_id: parsed.data.id,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// T3.5 — OEM selection approval
// ---------------------------------------------------------------------------
export async function proposeSelection(
  input: unknown,
): Promise<SourcingResult> {
  const g = await guard();
  if (!g.ok) return g;
  const parsed = selectionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid selection" };
  }
  const supabase = await createClient();

  const { data: selection, error } = await supabase
    .from("oem_selection")
    .insert({
      requirement_line_id: parsed.data.requirementLineId,
      partner_id: parsed.data.partnerId,
      qty_allocated: parsed.data.qtyAllocated,
      status: "proposed",
      notes: parsed.data.notes ?? null,
      created_by: g.userId,
      updated_by: g.userId,
    })
    .select("id")
    .single();
  if (error || !selection) return { ok: false, error: friendlyError(error?.message ?? "", error?.code) };

  const { data: approvalId, error: approvalError } = await supabase.rpc(
    "request_approval",
    {
      p_subject_type: "oem_selection",
      p_subject_id: selection.id,
      p_reason: `OEM selection for ${parsed.data.qtyAllocated} unit(s)`,
    },
  );
  if (approvalError) {
    return { ok: false, error: friendlyError(approvalError.message, approvalError.code) };
  }

  await supabase
    .from("oem_selection")
    .update({ approval_id: approvalId as string })
    .eq("id", selection.id);

  revalidate(parsed.data.requirementId);
  revalidatePath("/approvals");
  return { ok: true, id: selection.id };
}
