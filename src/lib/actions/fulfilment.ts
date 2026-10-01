"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser, type AppRole } from "@/lib/auth/get-user";
import { friendlyError } from "@/lib/actions/errors";
import { createClient } from "@/lib/supabase/server";

const WRITE_ROLES: AppRole[] = ["owner", "sales", "operations", "admin"];

export type FulfilResult = { ok: true; id?: string } | { ok: false; error: string };

async function requireWriter(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (!user.roles.some((role) => WRITE_ROLES.includes(role))) {
    return { ok: false, error: "You do not have permission to manage fulfilment." };
  }
  return { ok: true, userId: user.id };
}

function revalidatePo(poId: string) {
  revalidatePath(`/orders/${poId}`);
  revalidatePath(`/orders/${poId}/fulfilment`);
  revalidatePath("/dashboard");
}

export async function updateMilestone(input: {
  id: string;
  customerPoId: string;
  status?: string;
  expectedDate?: string | null;
  actualDate?: string | null;
  ownerUserId?: string | null;
  notes?: string | null;
}): Promise<FulfilResult> {
  const g = await requireWriter();
  if (!g.ok) return g;
  const supabase = await createClient();
  const { error } = await supabase
    .from("fulfilment_milestone")
    .update({
      status: input.status,
      expected_date: input.expectedDate ?? null,
      actual_date: input.actualDate ?? null,
      owner_user_id: input.ownerUserId ?? null,
      notes: input.notes ?? null,
    })
    .eq("id", input.id);
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };
  revalidatePo(input.customerPoId);
  return { ok: true, id: input.id };
}

export async function addReadiness(input: {
  customerPoId: string;
  poLineId: string;
  readyQty: number;
  notes?: string | null;
}): Promise<FulfilResult> {
  const g = await requireWriter();
  if (!g.ok) return g;
  const supabase = await createClient();
  const { error } = await supabase.from("material_readiness").insert({
    customer_po_id: input.customerPoId,
    po_line_id: input.poLineId,
    ready_qty: input.readyQty,
    notes: input.notes ?? null,
  });
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };
  revalidatePo(input.customerPoId);
  return { ok: true };
}

export async function createPdi(input: {
  customerPoId: string;
  lines: { poLineId: string; qtyOffered: number }[];
  parentPdiId?: string | null;
}): Promise<FulfilResult> {
  const g = await requireWriter();
  if (!g.ok) return g;
  if (input.lines.length === 0) return { ok: false, error: "Add at least one line." };
  const supabase = await createClient();
  const { data: pdi, error } = await supabase
    .from("pdi")
    .insert({
      customer_po_id: input.customerPoId,
      parent_pdi_id: input.parentPdiId ?? null,
      status: "called",
      created_by: g.userId,
    })
    .select("id")
    .single();
  if (error || !pdi) return { ok: false, error: friendlyError(error?.message ?? "", error?.code) };

  const { error: lineError } = await supabase.from("pdi_line").insert(
    input.lines.map((line) => ({
      pdi_id: pdi.id,
      po_line_id: line.poLineId,
      qty_offered: line.qtyOffered,
    })),
  );
  if (lineError) return { ok: false, error: friendlyError(lineError.message, lineError.code) };
  revalidatePo(input.customerPoId);
  return { ok: true, id: pdi.id };
}

export async function recordPdiResult(input: {
  id: string;
  customerPoId: string;
  qtyCleared: number;
  qtyRejected: number;
  qtyHeld: number;
}): Promise<FulfilResult> {
  const g = await requireWriter();
  if (!g.ok) return g;
  const supabase = await createClient();
  const { error } = await supabase
    .from("pdi_line")
    .update({
      qty_cleared: input.qtyCleared,
      qty_rejected: input.qtyRejected,
      qty_held: input.qtyHeld,
    })
    .eq("id", input.id);
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };
  revalidatePo(input.customerPoId);
  return { ok: true, id: input.id };
}

export async function createDispatch(input: {
  customerPoId: string;
  dispatchDate?: string;
  mode?: string;
  lrAwb?: string;
  ewayBill?: string;
  lines: { poLineId: string; qty: number }[];
}): Promise<FulfilResult> {
  const g = await requireWriter();
  if (!g.ok) return g;
  if (input.lines.length === 0) return { ok: false, error: "Add at least one line." };
  const supabase = await createClient();
  const { data: dispatch, error } = await supabase
    .from("dispatch")
    .insert({
      customer_po_id: input.customerPoId,
      dispatch_date: input.dispatchDate ?? null,
      mode: input.mode ?? null,
      lr_awb: input.lrAwb ?? null,
      eway_bill: input.ewayBill ?? null,
      created_by: g.userId,
    })
    .select("id")
    .single();
  if (error || !dispatch) return { ok: false, error: friendlyError(error?.message ?? "", error?.code) };

  const { error: lineError } = await supabase.from("dispatch_line").insert(
    input.lines.map((line) => ({
      dispatch_id: dispatch.id,
      po_line_id: line.poLineId,
      qty: line.qty,
    })),
  );
  if (lineError) return { ok: false, error: friendlyError(lineError.message, lineError.code) };
  revalidatePo(input.customerPoId);
  return { ok: true, id: dispatch.id };
}

export async function requestDispatchOverride(input: {
  customerPoId: string;
  poLineId: string;
  qty: number;
  reason: string;
}): Promise<FulfilResult> {
  const g = await requireWriter();
  if (!g.ok) return g;
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_dispatch_override", {
    p_po_line_id: input.poLineId,
    p_qty: input.qty,
    p_reason: input.reason,
  });
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };
  revalidatePo(input.customerPoId);
  revalidatePath("/approvals");
  return { ok: true };
}

export async function createDelivery(input: {
  customerPoId: string;
  dispatchId?: string | null;
  deliveryDate?: string;
  grnNumber?: string;
  mode?: string;
  lines: { poLineId: string; qty: number }[];
}): Promise<FulfilResult> {
  const g = await requireWriter();
  if (!g.ok) return g;
  if (input.lines.length === 0) return { ok: false, error: "Add at least one line." };
  const supabase = await createClient();
  const { data: delivery, error } = await supabase
    .from("delivery")
    .insert({
      customer_po_id: input.customerPoId,
      dispatch_id: input.dispatchId ?? null,
      delivery_date: input.deliveryDate ?? null,
      grn_number: input.grnNumber ?? null,
      mode: input.mode ?? null,
      status: "delivered",
      created_by: g.userId,
    })
    .select("id")
    .single();
  if (error || !delivery) return { ok: false, error: friendlyError(error?.message ?? "", error?.code) };

  const { error: lineError } = await supabase.from("delivery_line").insert(
    input.lines.map((line) => ({
      delivery_id: delivery.id,
      po_line_id: line.poLineId,
      qty: line.qty,
    })),
  );
  if (lineError) return { ok: false, error: friendlyError(lineError.message, lineError.code) };
  revalidatePo(input.customerPoId);
  return { ok: true, id: delivery.id };
}

export async function createAcceptance(input: {
  customerPoId: string;
  deliveryId?: string | null;
  lines: { poLineId: string; qtyAccepted: number; qtyRejected: number }[];
}): Promise<FulfilResult> {
  const g = await requireWriter();
  if (!g.ok) return g;
  if (input.lines.length === 0) return { ok: false, error: "Add at least one line." };
  const supabase = await createClient();
  const { data: acceptance, error } = await supabase
    .from("acceptance")
    .insert({
      customer_po_id: input.customerPoId,
      delivery_id: input.deliveryId ?? null,
      status: "accepted",
      created_by: g.userId,
    })
    .select("id")
    .single();
  if (error || !acceptance)
    return { ok: false, error: friendlyError(error?.message ?? "", error?.code) };

  const { error: lineError } = await supabase.from("acceptance_line").insert(
    input.lines.map((line) => ({
      acceptance_id: acceptance.id,
      po_line_id: line.poLineId,
      qty_accepted: line.qtyAccepted,
      qty_rejected: line.qtyRejected,
    })),
  );
  if (lineError) return { ok: false, error: friendlyError(lineError.message, lineError.code) };
  revalidatePo(input.customerPoId);
  revalidatePath("/tasks");
  return { ok: true, id: acceptance.id };
}

export async function createExtensionRequest(input: {
  customerPoId: string;
  poLineId?: string | null;
  requestedDate: string;
  reason: string;
  letterText?: string | null;
}): Promise<FulfilResult> {
  const g = await requireWriter();
  if (!g.ok) return g;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("extension_request")
    .insert({
      customer_po_id: input.customerPoId,
      po_line_id: input.poLineId ?? null,
      requested_date: input.requestedDate,
      reason: input.reason,
      letter_text: input.letterText ?? null,
      created_by: g.userId,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: friendlyError(error?.message ?? "", error?.code) };
  revalidatePo(input.customerPoId);
  return { ok: true, id: data.id };
}

export async function transitionExtension(input: {
  id: string;
  customerPoId: string;
  toStatus: "pending_approval" | "approved" | "sent" | "granted" | "refused";
  reason?: string;
}): Promise<FulfilResult> {
  const g = await requireWriter();
  if (!g.ok) return g;
  const supabase = await createClient();
  const { error } = await supabase.rpc("transition_extension_request", {
    p_id: input.id,
    p_to_status: input.toStatus,
    p_reason: input.reason ?? null,
  });
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };
  revalidatePo(input.customerPoId);
  revalidatePath("/approvals");
  return { ok: true };
}
