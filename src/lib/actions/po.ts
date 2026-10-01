"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser, type AppRole } from "@/lib/auth/get-user";
import { friendlyError } from "@/lib/actions/errors";
import { createClient } from "@/lib/supabase/server";

const WRITE_ROLES: AppRole[] = ["owner", "sales", "operations", "admin"];

export type PoResult = { ok: true; id?: string } | { ok: false; error: string };

async function requireWriter(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (!user.roles.some((role) => WRITE_ROLES.includes(role))) {
    return { ok: false, error: "You do not have permission to manage POs." };
  }
  return { ok: true, userId: user.id };
}

function revalidatePo(poId?: string) {
  revalidatePath("/orders");
  if (poId) revalidatePath(`/orders/${poId}`);
  revalidatePath("/dashboard");
}

/** Pre-fill a customer PO from an approved/submitted quotation version. */
export async function createCustomerPo(input: {
  versionId: string;
  customerPoNumber: string;
  poDate?: string;
  paymentTerms?: string;
  deliveryTerms?: string;
  pdiRequired?: boolean;
  notes?: string;
}): Promise<PoResult> {
  const g = await requireWriter();
  if (!g.ok) return g;
  if (!input.customerPoNumber.trim()) {
    return { ok: false, error: "A customer PO number is required." };
  }

  const supabase = await createClient();
  const { data: version } = await supabase
    .from("quotation_version")
    .select(
      "id, quotation_id, status, payment_terms, delivery_terms, quotation:quotation_id(requirement_id, requirement:requirement_id(customer_id))",
    )
    .eq("id", input.versionId)
    .maybeSingle();
  if (!version) return { ok: false, error: "Quotation version not found." };

  const quotation = version.quotation as unknown as {
    requirement_id: string;
    requirement: { customer_id: string } | null;
  };
  if (!quotation.requirement?.customer_id) {
    return { ok: false, error: "The requirement has no customer." };
  }

  const { data: po, error } = await supabase
    .from("customer_po")
    .insert({
      quotation_version_id: input.versionId,
      customer_id: quotation.requirement.customer_id,
      customer_po_number: input.customerPoNumber.trim(),
      po_date: input.poDate ?? null,
      payment_terms: input.paymentTerms ?? version.payment_terms ?? null,
      delivery_terms: input.deliveryTerms ?? version.delivery_terms ?? null,
      pdi_required: input.pdiRequired ?? false,
      notes: input.notes ?? null,
      created_by: g.userId,
      updated_by: g.userId,
    })
    .select("id")
    .single();
  if (error || !po) return { ok: false, error: friendlyError(error?.message ?? "", error?.code) };

  const { data: lines } = await supabase
    .from("quotation_line")
    .select("id, requirement_line_id, qty_quoted, uom, proposed_unit_price")
    .eq("quotation_version_id", input.versionId);

  if (lines && lines.length > 0) {
    const { error: lineError } = await supabase.from("po_line").insert(
      lines.map((line) => ({
        customer_po_id: po.id,
        quotation_line_id: line.id,
        requirement_line_id: line.requirement_line_id,
        qty_ordered: line.qty_quoted,
        qty_ordered_effective: line.qty_quoted,
        unit_rate: line.proposed_unit_price && line.proposed_unit_price > 0 ? line.proposed_unit_price : 1,
        uom: line.uom,
      })),
    );
    if (lineError) return { ok: false, error: friendlyError(lineError.message, lineError.code) };
  }

  revalidatePo(po.id);
  return { ok: true, id: po.id };
}

export async function updatePoLine(input: {
  id: string;
  customerPoId: string;
  qtyOrdered?: number;
  unitRate?: number;
  uom?: string;
  deliveryTerms?: string;
}): Promise<PoResult> {
  const g = await requireWriter();
  if (!g.ok) return g;
  const supabase = await createClient();
  const { error } = await supabase
    .from("po_line")
    .update({
      qty_ordered: input.qtyOrdered,
      qty_ordered_effective: input.qtyOrdered,
      unit_rate: input.unitRate,
      uom: input.uom,
      delivery_terms: input.deliveryTerms ?? null,
    })
    .eq("id", input.id);
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };
  revalidatePo(input.customerPoId);
  return { ok: true, id: input.id };
}

export async function savePoSchedule(input: {
  poLineId: string;
  customerPoId: string;
  rows: { qty: number; dueDate?: string | null; notes?: string | null }[];
}): Promise<PoResult> {
  const g = await requireWriter();
  if (!g.ok) return g;
  const supabase = await createClient();
  const { error: delError } = await supabase
    .from("po_delivery_schedule")
    .delete()
    .eq("po_line_id", input.poLineId);
  if (delError) return { ok: false, error: friendlyError(delError.message, delError.code) };

  if (input.rows.length > 0) {
    const { error } = await supabase.from("po_delivery_schedule").insert(
      input.rows.map((row, index) => ({
        po_line_id: input.poLineId,
        sequence: index + 1,
        qty: row.qty,
        due_date: row.dueDate ?? null,
        original_committed_date: row.dueDate ?? null,
        notes: row.notes ?? null,
      })),
    );
    if (error) return { ok: false, error: friendlyError(error.message, error.code) };
  }
  revalidatePo(input.customerPoId);
  return { ok: true };
}

export async function transitionPo(input: {
  id: string;
  toStatus: "received" | "under_review" | "acknowledged" | "amended" | "completed" | "cancelled";
  reason?: string;
}): Promise<PoResult> {
  const g = await requireWriter();
  if (!g.ok) return g;
  const supabase = await createClient();
  const { error } = await supabase.rpc("transition_customer_po", {
    p_id: input.id,
    p_to_status: input.toStatus,
    p_reason: input.reason ?? null,
  });
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };
  revalidatePo(input.id);
  return { ok: true };
}

export async function resolvePoMismatch(input: {
  id: string;
  customerPoId: string;
  resolution: "corrected" | "amendment_requested" | "accepted";
  reason?: string;
}): Promise<PoResult> {
  const g = await requireWriter();
  if (!g.ok) return g;
  const supabase = await createClient();
  const { error } = await supabase
    .from("po_mismatch")
    .update({
      resolution: input.resolution,
      reason: input.reason ?? null,
      resolved_by: g.userId,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", input.id);
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };
  revalidatePo(input.customerPoId);
  return { ok: true };
}

export async function createPoAmendment(input: {
  customerPoId: string;
  reason?: string;
  changes: { poLineId: string; field: "qty" | "unit_rate" | "delivery_terms"; oldValue: string; newValue: string }[];
}): Promise<PoResult> {
  const g = await requireWriter();
  if (!g.ok) return g;
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("po_amendment")
    .select("amendment_no")
    .eq("customer_po_id", input.customerPoId)
    .order("amendment_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextNo = ((existing?.amendment_no as number) ?? 0) + 1;

  const { data: amendment, error } = await supabase
    .from("po_amendment")
    .insert({ customer_po_id: input.customerPoId, amendment_no: nextNo, reason: input.reason ?? null, created_by: g.userId })
    .select("id")
    .single();
  if (error || !amendment) return { ok: false, error: friendlyError(error?.message ?? "", error?.code) };

  if (input.changes.length > 0) {
    const { error: changeError } = await supabase.from("po_amendment_change").insert(
      input.changes.map((change) => ({
        po_amendment_id: amendment.id,
        po_line_id: change.poLineId,
        field: change.field,
        old_value: change.oldValue,
        new_value: change.newValue,
      })),
    );
    if (changeError) return { ok: false, error: friendlyError(changeError.message, changeError.code) };
  }

  revalidatePo(input.customerPoId);
  return { ok: true, id: amendment.id };
}

export async function applyPoAmendment(input: {
  amendmentId: string;
  customerPoId: string;
}): Promise<PoResult> {
  const g = await requireWriter();
  if (!g.ok) return g;
  const supabase = await createClient();
  const { error } = await supabase.rpc("apply_po_amendment", {
    p_amendment_id: input.amendmentId,
  });
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };
  revalidatePo(input.customerPoId);
  return { ok: true };
}

export async function createSupplierPo(input: {
  customerPoId: string;
  partnerId: string;
  lines: { poLineId: string; qty: number; unitCost?: number }[];
}): Promise<PoResult> {
  const g = await requireWriter();
  if (!g.ok) return g;
  if (input.lines.length === 0) return { ok: false, error: "Add at least one line." };
  const supabase = await createClient();

  const { data: spo, error } = await supabase
    .from("supplier_po")
    .insert({ customer_po_id: input.customerPoId, partner_id: input.partnerId, created_by: g.userId })
    .select("id")
    .single();
  if (error || !spo) return { ok: false, error: friendlyError(error?.message ?? "", error?.code) };

  const { error: lineError } = await supabase.from("supplier_po_line").insert(
    input.lines.map((line) => ({
      supplier_po_id: spo.id,
      po_line_id: line.poLineId,
      qty: line.qty,
      unit_cost: line.unitCost ?? null,
    })),
  );
  if (lineError) return { ok: false, error: friendlyError(lineError.message, lineError.code) };

  revalidatePo(input.customerPoId);
  return { ok: true, id: spo.id };
}

export async function attachPoDocument(input: {
  id: string;
  documentId: string;
}): Promise<PoResult> {
  const g = await requireWriter();
  if (!g.ok) return g;
  const supabase = await createClient();
  const { error } = await supabase
    .from("customer_po")
    .update({ acknowledgement_document_id: input.documentId })
    .eq("id", input.id);
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };
  revalidatePo(input.id);
  return { ok: true };
}
