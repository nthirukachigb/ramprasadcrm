"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser, type AppRole } from "@/lib/auth/get-user";
import { friendlyError } from "@/lib/actions/errors";
import { createClient } from "@/lib/supabase/server";

const WRITE_ROLES: AppRole[] = ["owner", "sales", "operations", "admin"];

export type ResponseResult = { ok: true; id?: string } | { ok: false; error: string };

export async function createCustomerResponse(input: {
  quotationId: string;
}): Promise<ResponseResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (!user.roles.some((role) => WRITE_ROLES.includes(role))) {
    return { ok: false, error: "You do not have permission to record a response." };
  }
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("customer_response")
    .select("id")
    .eq("quotation_id", input.quotationId)
    .maybeSingle();
  if (existing) return { ok: true, id: existing.id as string };

  const { data, error } = await supabase
    .from("customer_response")
    .insert({ quotation_id: input.quotationId, status: "submitted", created_by: user.id })
    .select("id")
    .single();
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };
  return { ok: true, id: data.id };
}

export async function transitionResponse(input: {
  id: string;
  versionId: string;
  toStatus:
    | "clarification_requested"
    | "technical_clarification"
    | "commercial_negotiation"
    | "awaiting_decision"
    | "won"
    | "partially_won"
    | "lost"
    | "cancelled";
  reason?: string;
}): Promise<ResponseResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("transition_customer_response", {
    p_id: input.id,
    p_to_status: input.toStatus,
    p_reason: input.reason ?? null,
  });
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };
  revalidatePath(`/quotations/${input.versionId}/responses`);
  revalidatePath(`/quotations/${input.versionId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function addNegotiationEvent(input: {
  customerResponseId: string;
  versionId: string;
  eventType: string;
  detail?: string;
  priceChangeRequested?: boolean;
  requestedPrice?: number | null;
  agreed?: boolean;
  approvedVersionId?: string | null;
}): Promise<ResponseResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (!user.roles.some((role) => WRITE_ROLES.includes(role))) {
    return { ok: false, error: "You do not have permission to record a negotiation." };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("negotiation_event").insert({
    customer_response_id: input.customerResponseId,
    event_type: input.eventType,
    detail: input.detail ?? null,
    price_change_requested: input.priceChangeRequested ?? false,
    requested_price: input.requestedPrice ?? null,
    agreed: input.agreed ?? false,
    approved_version_id: input.approvedVersionId ?? null,
  });
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };
  revalidatePath(`/quotations/${input.versionId}/responses`);
  return { ok: true };
}
