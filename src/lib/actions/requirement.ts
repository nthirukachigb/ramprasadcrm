"use server";

import { revalidatePath } from "next/cache";
import type { ZodType } from "zod";

import { getCurrentUser, type AppRole } from "@/lib/auth/get-user";
import { friendlyError } from "@/lib/actions/errors";
import {
  clarificationSchema,
  qualificationSchema,
  requirementSchema,
  requirementUpdateSchema,
  statusChangeSchema,
  type RequirementInput,
} from "@/lib/schemas/requirement";
import { createClient } from "@/lib/supabase/server";

export type RequirementActionResult =
  | { ok: true; id: string; internalRef?: string }
  | { ok: false; error: string };

const WRITE_ROLES: AppRole[] = ["owner", "sales", "operations", "admin"];

async function guard(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (!user.roles.some((role) => WRITE_ROLES.includes(role))) {
    return {
      ok: false,
      error: "You do not have permission to manage requirements.",
    };
  }
  return { ok: true, userId: user.id };
}

function parse<T>(
  schema: ZodType<T>,
  input: unknown,
): { ok: true; data: T } | { ok: false; error: string } {
  const result = schema.safeParse(input);
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues[0]?.message ?? "Please check the values.",
    };
  }
  return { ok: true, data: result.data };
}

function toRow(data: RequirementInput) {
  return {
    requirement_type: data.requirementType,
    customer_id: data.customerId,
    division_id: data.divisionId ?? null,
    location_id: data.locationId ?? null,
    primary_client_id: data.primaryClientId ?? null,
    project_name: data.projectName ?? null,
    source_channel: data.sourceChannel,
    source_detail: data.sourceDetail ?? null,
    customer_reference: data.customerReference,
    portal_tender_no: data.portalTenderNo ?? null,
    enquiry_date: data.enquiryDate,
    received_date: data.receivedDate ?? null,
    submission_deadline: data.submissionDeadline ?? null,
    deadline_tbc: data.deadlineTbc,
    clarification_deadline: data.clarificationDeadline ?? null,
    quotation_validity_required_days:
      data.quotationValidityRequiredDays ?? null,
    bid_type: data.bidType ?? null,
    submission_type: data.submissionType ?? null,
    staggered_delivery: data.staggeredDelivery,
    required_delivery_summary: data.requiredDeliverySummary ?? null,
    payment_terms_requested: data.paymentTermsRequested ?? null,
    approval_requirements_summary: data.approvalRequirementsSummary ?? null,
    assigned_user_id: data.assignedUserId ?? null,
    estimated_value: data.estimatedValue ?? null,
    notes: data.notes ?? null,
  };
}

export async function createRequirement(
  input: unknown,
): Promise<RequirementActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const p = parse(requirementSchema, input);
  if (!p.ok) return p;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("requirement")
    .insert({ ...toRow(p.data), created_by: g.userId, updated_by: g.userId })
    .select("id, internal_ref")
    .single();

  if (error) return { ok: false, error: friendlyError(error.message, error.code) };

  revalidatePath("/requirements");
  revalidatePath("/dashboard");
  return { ok: true, id: data.id, internalRef: data.internal_ref };
}

export async function updateRequirement(
  input: unknown,
): Promise<RequirementActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const p = parse(requirementUpdateSchema, input);
  if (!p.ok) return p;

  const supabase = await createClient();
  const { error } = await supabase
    .from("requirement")
    .update({ ...toRow(p.data), updated_by: g.userId })
    .eq("id", p.data.id);

  if (error) return { ok: false, error: friendlyError(error.message, error.code) };

  revalidatePath(`/requirements/${p.data.id}`);
  revalidatePath("/requirements");
  return { ok: true, id: p.data.id };
}

/** A direct, allowed transition (no approval required). */
export async function setRequirementStatus(
  input: unknown,
): Promise<RequirementActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const p = parse(statusChangeSchema, input);
  if (!p.ok) return p;

  const supabase = await createClient();
  const { error } = await supabase.rpc("transition_requirement", {
    p_id: p.data.id,
    p_to_status: p.data.toStatus,
    p_reason: p.data.reason ?? null,
  });

  if (error) return { ok: false, error: friendlyError(error.message, error.code) };

  revalidatePath(`/requirements/${p.data.id}`);
  revalidatePath("/requirements");
  revalidatePath("/dashboard");
  return { ok: true, id: p.data.id };
}

/**
 * Qualification (FR-RFI-04). "Pursue" moves Received -> Qualifying directly.
 * "Pass" raises an Owner approval; the transition to Not pursued happens when
 * the Owner approves (see lib/actions/approvals.ts).
 */
export async function requestQualification(
  input: unknown,
): Promise<RequirementActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const p = parse(qualificationSchema, input);
  if (!p.ok) return p;

  const supabase = await createClient();

  if (p.data.decision === "pursue") {
    const { error } = await supabase.rpc("transition_requirement", {
      p_id: p.data.requirementId,
      p_to_status: "qualifying",
      p_reason: p.data.note ?? "Qualified to pursue",
    });
    if (error) {
      return { ok: false, error: friendlyError(error.message, error.code) };
    }
    revalidatePath(`/requirements/${p.data.requirementId}`);
    revalidatePath("/dashboard");
    return { ok: true, id: p.data.requirementId };
  }

  const { error: updateError } = await supabase
    .from("requirement")
    .update({
      qualification_decision: "pass_requested",
      pass_reason: p.data.reason ?? null,
    })
    .eq("id", p.data.requirementId);
  if (updateError) {
    return { ok: false, error: friendlyError(updateError.message, updateError.code) };
  }

  const { error } = await supabase.rpc("request_approval", {
    p_subject_type: "requirement",
    p_subject_id: p.data.requirementId,
    p_reason: p.data.reason ?? "Pass (not pursued)",
  });
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };

  revalidatePath(`/requirements/${p.data.requirementId}`);
  revalidatePath("/approvals");
  return { ok: true, id: p.data.requirementId };
}

export async function createClarification(
  input: unknown,
): Promise<RequirementActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const p = parse(clarificationSchema, input);
  if (!p.ok) return p;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("clarification")
    .insert({
      requirement_id: p.data.requirementId,
      requirement_line_id: p.data.requirementLineId ?? null,
      clarification_type: p.data.clarificationType,
      subject: p.data.subject,
      detail: p.data.detail ?? null,
      owner_user_id: p.data.ownerUserId ?? null,
      due_date: p.data.dueDate ?? null,
      created_by: g.userId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };

  revalidatePath(`/requirements/${p.data.requirementId}`);
  return { ok: true, id: data.id };
}

export async function setClarificationStatus(input: {
  id: string;
  requirementId: string;
  status: "open" | "responded" | "closed";
  responseText?: string;
}): Promise<RequirementActionResult> {
  const g = await guard();
  if (!g.ok) return g;

  const supabase = await createClient();
  const { error } = await supabase
    .from("clarification")
    .update({ status: input.status, response_text: input.responseText ?? null })
    .eq("id", input.id);
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };

  revalidatePath(`/requirements/${input.requirementId}`);
  return { ok: true, id: input.id };
}
