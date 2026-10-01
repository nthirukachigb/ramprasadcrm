"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser, type AppRole } from "@/lib/auth/get-user";
import { friendlyError } from "@/lib/actions/errors";
import { createClient } from "@/lib/supabase/server";
import {
  quotationHeaderSchema,
  quotationLineUpdateSchema,
  revisionSchema,
  submissionSchema,
  taxLineSchema,
} from "@/lib/schemas/quotation";

const WRITE_ROLES: AppRole[] = ["owner", "sales", "operations", "admin"];

export type QuotationResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

async function requireWriter(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (!user.roles.some((role) => WRITE_ROLES.includes(role))) {
    return { ok: false, error: "You do not have permission to manage quotations." };
  }
  return { ok: true, userId: user.id };
}

function revalidateVersion(versionId: string, requirementId?: string | null) {
  revalidatePath(`/quotations/${versionId}`);
  revalidatePath("/quotations");
  if (requirementId) {
    revalidatePath(`/requirements/${requirementId}`);
    revalidatePath(`/requirements/${requirementId}/quotations`);
  }
  revalidatePath("/dashboard");
}

export async function createQuotationFromRequirement(input: {
  requirementId: string;
  lineIds: string[];
}): Promise<QuotationResult> {
  const g = await requireWriter();
  if (!g.ok) return g;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_quotation_from_requirement", {
    p_requirement_id: input.requirementId,
    p_line_ids: input.lineIds,
  });
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };

  revalidatePath(`/requirements/${input.requirementId}/quotations`);
  return { ok: true, id: data as string };
}

export async function updateQuotationLine(input: unknown): Promise<QuotationResult> {
  const g = await requireWriter();
  if (!g.ok) return g;
  const parsed = quotationLineUpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid line" };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("quotation_line")
    .update({
      unit_cost: d.unitCost ?? null,
      freight_unit: d.freightUnit ?? null,
      other_cost_unit: d.otherCostUnit ?? null,
      target_margin_pct: d.targetMarginPct ?? null,
      proposed_unit_price: d.proposedUnitPrice ?? null,
      lead_time_days: d.leadTimeDays ?? null,
      sourcing_basis: d.sourcingBasis ?? null,
      notes: d.notes ?? null,
    })
    .eq("id", d.lineId);
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };

  revalidateVersion(d.versionId);
  return { ok: true, id: d.lineId };
}

export async function saveQuotationHeader(input: unknown): Promise<QuotationResult> {
  const g = await requireWriter();
  if (!g.ok) return g;
  const parsed = quotationHeaderSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid header" };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("quotation_version")
    .update({
      currency: d.currency,
      fx_rate: d.fxRate,
      valid_until: d.validUntil ?? null,
      delivery_terms: d.deliveryTerms ?? null,
      payment_terms: d.paymentTerms ?? null,
      technical_compliance_declared: d.technicalCompliance,
      commercial_compliance_declared: d.commercialCompliance,
      declared_by: g.userId,
      declared_at: new Date().toISOString(),
    })
    .eq("id", d.versionId);
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };

  revalidateVersion(d.versionId);
  return { ok: true, id: d.versionId };
}

export async function addTaxLine(input: unknown): Promise<QuotationResult> {
  const g = await requireWriter();
  if (!g.ok) return g;
  const parsed = taxLineSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid tax line" };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from("tax_line").insert({
    parent_type: "quotation_version",
    parent_id: d.versionId,
    tax_type: d.taxType,
    rate_pct: d.ratePct ?? null,
    taxable_amount: d.taxableAmount ?? null,
    amount: d.amount,
  });
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };

  revalidateVersion(d.versionId);
  return { ok: true };
}

export async function deleteTaxLine(input: {
  id: string;
  versionId: string;
}): Promise<QuotationResult> {
  const g = await requireWriter();
  if (!g.ok) return g;
  const supabase = await createClient();
  const { error } = await supabase.from("tax_line").delete().eq("id", input.id);
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };
  revalidateVersion(input.versionId);
  return { ok: true };
}

export async function deleteQuotationLine(input: {
  id: string;
  versionId: string;
}): Promise<QuotationResult> {
  const g = await requireWriter();
  if (!g.ok) return g;
  const supabase = await createClient();
  const { error } = await supabase.from("quotation_line").delete().eq("id", input.id);
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };
  revalidateVersion(input.versionId);
  return { ok: true };
}

export async function submitQuotation(input: {
  versionId: string;
}): Promise<QuotationResult> {
  const g = await requireWriter();
  if (!g.ok) return g;
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_quote_for_approval", {
    p_version_id: input.versionId,
  });
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };
  revalidateVersion(input.versionId);
  revalidatePath("/approvals");
  return { ok: true };
}

export async function approveQuotation(input: {
  versionId: string;
  comment: string;
}): Promise<QuotationResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (!user.roles.some((role) => ["owner", "admin"].includes(role))) {
    return { ok: false, error: "Only the Owner or Admin may approve a quotation." };
  }
  if (input.comment.trim().length < 3) {
    return { ok: false, error: "An approval comment is required." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("approve_quotation_version", {
    p_version_id: input.versionId,
    p_comment: input.comment,
  });
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };

  revalidateVersion(input.versionId);
  revalidatePath("/approvals");
  return { ok: true };
}

export async function createQuotationRevision(input: unknown): Promise<QuotationResult> {
  const g = await requireWriter();
  if (!g.ok) return g;
  const parsed = revisionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid revision" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_revision", {
    p_version_id: parsed.data.versionId,
    p_reason: parsed.data.reason,
  });
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };
  revalidateVersion(parsed.data.versionId);
  return { ok: true, id: data as string };
}

export async function recordQuotationSubmission(
  input: unknown,
): Promise<QuotationResult> {
  const g = await requireWriter();
  if (!g.ok) return g;
  const parsed = submissionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid submission" };
  }
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_quotation_submission", {
    p_version_id: d.versionId,
    p_mode: d.mode,
    p_at: d.at,
    p_ref: d.reference ?? null,
    p_proof_document_id: d.proofDocumentId ?? null,
    p_late_reason: d.lateReason ?? null,
  });
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };
  revalidateVersion(d.versionId);
  return { ok: true };
}

export interface ComparableRow {
  quotation_line_id: string;
  requirement_id: string;
  requirement_ref: string | null;
  quotation_version_id?: string;
  quotation_id?: string;
  version_no: number;
  proposed_unit_price: number | null;
  negotiated_unit_price?: number | null;
  po_unit_rate?: number | null;
  oem_name?: string | null;
  oem_cost_unit?: number | null;
  margin_pct?: number | null;
  lead_time_days?: number | null;
  line_outcome: string | null;
  loss_reason?: string | null;
  match_basis: string;
  competitor?: string | null;
  winning_price?: number | null;
  pdi_rejected_qty?: number | null;
  is_migrated?: boolean;
  is_validated?: boolean;
}

export async function getComparableHistory(
  lineId: string,
): Promise<{ ok: true; rows: ComparableRow[] } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (!user.roles.some((role) => ["owner", "sales", "admin"].includes(role))) {
    return { ok: false, error: "Comparable history is available to Sales, Owner or Admin." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("comparable_history", {
    p_line_id: lineId,
  });
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };

  await supabase.rpc("log_history_view", { p_line_id: lineId });
  return { ok: true, rows: (data ?? []) as ComparableRow[] };
}
