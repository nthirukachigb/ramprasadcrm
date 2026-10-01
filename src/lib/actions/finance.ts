"use server";

import { revalidatePath } from "next/cache";

import { friendlyError } from "@/lib/actions/errors";
import { getCurrentUser, type AppRole } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";

const WRITE_ROLES: AppRole[] = ["owner", "finance", "sales", "operations", "admin"];

export type FinanceResult = { ok: true; id?: string } | { ok: false; error: string };

async function requireWriter(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (!user.roles.some((role) => WRITE_ROLES.includes(role))) {
    return { ok: false, error: "You do not have permission to manage finance records." };
  }
  return { ok: true, userId: user.id };
}

function revalidateFinance() {
  revalidatePath("/invoices");
  revalidatePath("/payments");
  revalidatePath("/dashboard");
}

async function syncInvoiceStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  invoiceId: string,
  userId: string,
) {
  const { data: invoice, error: invoiceError } = await supabase
    .from("invoice")
    .select("gross_amount, status")
    .eq("id", invoiceId)
    .maybeSingle();

  if (invoiceError || !invoice) return;

  const [{ data: allocations }, { data: deductions }] = await Promise.all([
    supabase
      .from("payment_allocation")
      .select("amount")
      .eq("invoice_id", invoiceId),
    supabase
      .from("deduction")
      .select("amount")
      .eq("invoice_id", invoiceId),
  ]);

  const paidAmount = (allocations ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const deductionAmount = (deductions ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const balanceAmount = Number(invoice.gross_amount ?? 0) - paidAmount - deductionAmount;

  let nextStatus = "submitted";
  if (balanceAmount <= 0) nextStatus = "paid";
  else if (paidAmount > 0) nextStatus = "partially_paid";

  if (invoice.status !== nextStatus) {
    await supabase
      .from("invoice")
      .update({ status: nextStatus, updated_by: userId, updated_at: new Date().toISOString() })
      .eq("id", invoiceId);
  }
}

export async function createInvoice(input: {
  invoiceNumber: string;
  poLineId: string;
  invoiceDate?: string;
  dueDate?: string | null;
  qty: number;
  unitRate: number;
  taxRate?: number;
  notes?: string | null;
}): Promise<FinanceResult> {
  const g = await requireWriter();
  if (!g.ok) return g;

  const qty = Number(input.qty);
  const unitRate = Number(input.unitRate);
  const taxRate = Number(input.taxRate ?? 0);

  if (!input.invoiceNumber.trim()) {
    return { ok: false, error: "An invoice number is required." };
  }
  if (!input.poLineId) {
    return { ok: false, error: "Select a PO line." };
  }
  if (!Number.isFinite(qty) || qty <= 0) {
    return { ok: false, error: "Invoice quantity must be greater than zero." };
  }
  if (!Number.isFinite(unitRate) || unitRate < 0) {
    return { ok: false, error: "Unit rate must be zero or greater." };
  }

  const supabase = await createClient();
  const { data: poLine, error: poLineError } = await supabase
    .from("po_line")
    .select("customer_po_id, qty_ordered_effective")
    .eq("id", input.poLineId)
    .maybeSingle();

  if (poLineError) return { ok: false, error: friendlyError(poLineError.message, poLineError.code) };
  if (!poLine) return { ok: false, error: "The selected PO line was not found." };

  const { data: existingInvoice, error: countError } = await supabase
    .from("invoice")
    .select("id")
    .eq("invoice_number", input.invoiceNumber.trim())
    .maybeSingle();

  if (countError) return { ok: false, error: friendlyError(countError.message, countError.code) };
  if (existingInvoice) {
    return { ok: false, error: "An invoice with that number already exists." };
  }

  const lineAmount = qty * unitRate;
  const taxAmount = lineAmount * (taxRate / 100);
  const grossAmount = lineAmount + taxAmount;

  const { data: invoice, error } = await supabase
    .from("invoice")
    .insert({
      customer_po_id: poLine.customer_po_id,
      invoice_number: input.invoiceNumber.trim(),
      invoice_date: input.invoiceDate ?? new Date().toISOString().slice(0, 10),
      due_date: input.dueDate ?? null,
      tax_amount: taxAmount,
      gross_amount: grossAmount,
      status: "submitted",
      notes: input.notes ?? null,
      created_by: g.userId,
      updated_by: g.userId,
    })
    .select("id")
    .single();

  if (error || !invoice) return { ok: false, error: friendlyError(error?.message ?? "", error?.code) };

  const { error: lineError } = await supabase.from("invoice_line").insert({
    invoice_id: invoice.id,
    po_line_id: input.poLineId,
    qty_invoiced: qty,
    unit_rate: unitRate,
    tax_rate: taxRate,
    line_amount: lineAmount,
    tax_amount: taxAmount,
    gross_amount: grossAmount,
  });

  if (lineError) return { ok: false, error: friendlyError(lineError.message, lineError.code) };

  revalidateFinance();
  revalidatePath(`/orders/${poLine.customer_po_id}`);
  return { ok: true, id: invoice.id };
}

export async function createPayment(input: {
  invoiceId: string;
  amount: number;
  paymentDate?: string;
  mode?: string;
  reference?: string;
  notes?: string | null;
}): Promise<FinanceResult> {
  const g = await requireWriter();
  if (!g.ok) return g;

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Payment amount must be greater than zero." };
  }

  const supabase = await createClient();
  const { data: invoice, error: invoiceError } = await supabase
    .from("invoice")
    .select("id, gross_amount")
    .eq("id", input.invoiceId)
    .maybeSingle();

  if (invoiceError) return { ok: false, error: friendlyError(invoiceError.message, invoiceError.code) };
  if (!invoice) return { ok: false, error: "Invoice not found." };

  const { data: payment, error } = await supabase
    .from("payment")
    .insert({
      payment_date: input.paymentDate ?? new Date().toISOString().slice(0, 10),
      amount,
      mode: input.mode ?? "bank_transfer",
      reference_no: input.reference ?? null,
      notes: input.notes ?? null,
      created_by: g.userId,
    })
    .select("id")
    .single();

  if (error || !payment) return { ok: false, error: friendlyError(error?.message ?? "", error?.code) };

  const { error: allocationError } = await supabase.from("payment_allocation").insert({
    payment_id: payment.id,
    invoice_id: input.invoiceId,
    amount,
    status: amount >= Number(invoice.gross_amount) ? "settled" : "allocated",
  });

  if (allocationError) return { ok: false, error: friendlyError(allocationError.message, allocationError.code) };

  await syncInvoiceStatus(supabase, input.invoiceId, g.userId);
  revalidateFinance();
  return { ok: true, id: payment.id };
}

export async function recordDeduction(input: {
  invoiceId: string;
  type: string;
  amount: number;
  status?: string;
  notes?: string | null;
}): Promise<FinanceResult> {
  const g = await requireWriter();
  if (!g.ok) return g;

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    return { ok: false, error: "Deduction amount must be zero or greater." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("deduction").insert({
    invoice_id: input.invoiceId,
    deduction_type: input.type,
    amount,
    status: input.status ?? "proposed",
    notes: input.notes ?? null,
    created_by: g.userId,
  });

  if (error) return { ok: false, error: friendlyError(error.message, error.code) };

  await syncInvoiceStatus(supabase, input.invoiceId, g.userId);
  revalidateFinance();
  return { ok: true };
}
