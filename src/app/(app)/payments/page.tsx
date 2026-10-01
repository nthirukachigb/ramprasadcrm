import type { Metadata } from "next";

import { FinanceWorkspace, type FinanceInvoiceRow, type FinancePaymentRow, type FinancePoLineOption } from "@/components/finance/FinanceWorkspace.client";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth/get-user";
import { canWriteRequirements } from "@/lib/requirements/write-check";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsPage() {
  const user = await requireUser();
  const canWrite = canWriteRequirements(user.roles);
  const supabase = await createClient();

  const [invoiceResult, paymentAllocationResult, deductionResult, poLineResult] = await Promise.all([
    supabase
      .from("invoice")
      .select("id, invoice_number, customer_po_id, gross_amount, tax_amount, status, invoice_date, due_date")
      .order("invoice_date", { ascending: false }),
    supabase
      .from("payment_allocation")
      .select("id, invoice_id, amount, status, payment:payment_id(payment_date, mode, reference_no)")
      .order("created_at", { ascending: false }),
    supabase
      .from("deduction")
      .select("id, invoice_id, deduction_type, amount, status, notes, invoice:invoice_id(invoice_number)")
      .order("created_at", { ascending: false }),
    supabase
      .from("po_line")
      .select(
        "id, customer_po_id, qty_ordered_effective, quotation_line:quotation_line_id(requirement_line:requirement_line_id(line_no, description)), customer_po:customer_po_id(internal_ref, customer_po_number)",
      )
      .order("created_at", { ascending: false }),
  ]);

  const paymentTotals = new Map<string, number>();
  for (const allocation of paymentAllocationResult.data ?? []) {
    paymentTotals.set(
      allocation.invoice_id,
      (paymentTotals.get(allocation.invoice_id) ?? 0) + Number(allocation.amount ?? 0),
    );
  }

  const deductionTotals = new Map<string, number>();
  for (const deduction of deductionResult.data ?? []) {
    deductionTotals.set(deduction.invoice_id, (deductionTotals.get(deduction.invoice_id) ?? 0) + Number(deduction.amount ?? 0));
  }

  const invoices: FinanceInvoiceRow[] = (invoiceResult.data ?? []).map((invoice) => {
    const paidAmount = Number(paymentTotals.get(invoice.id) ?? 0);
    const deductionAmount = Number(deductionTotals.get(invoice.id) ?? 0);
    const balanceAmount = Number(invoice.gross_amount ?? 0) - paidAmount - deductionAmount;
    const invoiceDate = new Date(invoice.invoice_date);
    const dueDate = invoice.due_date ? new Date(invoice.due_date) : invoiceDate;
    const ageDays = Math.max(0, Math.ceil((Date.now() - dueDate.getTime()) / 86400000));

    return {
      id: invoice.id,
      invoice_number: invoice.invoice_number,
      customer_po_id: invoice.customer_po_id,
      gross_amount: Number(invoice.gross_amount ?? 0),
      tax_amount: Number(invoice.tax_amount ?? 0),
      paid_amount: paidAmount,
      deduction_amount: deductionAmount,
      balance_amount: balanceAmount,
      status: invoice.status,
      invoice_date: invoice.invoice_date,
      due_date: invoice.due_date,
      age_days: ageDays,
    };
  });

  const payments: FinancePaymentRow[] = (paymentAllocationResult.data ?? []).map((allocation) => ({
    id: allocation.id,
    payment_date: (allocation.payment as { payment_date?: string } | null)?.payment_date ?? "",
    amount: Number(allocation.amount ?? 0),
    mode: (allocation.payment as { mode?: string } | null)?.mode ?? "bank_transfer",
    reference_no: (allocation.payment as { reference_no?: string } | null)?.reference_no ?? null,
  }));

  const deductions = (deductionResult.data ?? []).map((deduction) => ({
    id: deduction.id,
    invoice_id: deduction.invoice_id,
    invoice_number: (deduction.invoice as { invoice_number?: string } | null)?.invoice_number ?? "Invoice",
    deduction_type: deduction.deduction_type,
    amount: Number(deduction.amount ?? 0),
    status: deduction.status,
    notes: deduction.notes,
  }));

  const poLines: FinancePoLineOption[] = (poLineResult.data ?? []).map((row) => {
    const requirementLine = (row.quotation_line as unknown as { requirement_line?: { line_no: number; description: string } } | null)
      ?.requirement_line;
    const poRef = (row.customer_po as unknown as { internal_ref?: string; customer_po_number?: string } | null)?.internal_ref
      ?? (row.customer_po as unknown as { internal_ref?: string; customer_po_number?: string } | null)?.customer_po_number
      ?? "PO";

    return {
      id: row.id,
      customer_po_id: row.customer_po_id,
      po_ref: poRef,
      line_no: requirementLine?.line_no ?? 0,
      description: requirementLine?.description ?? "PO line",
      qty_ordered: Number(row.qty_ordered_effective ?? 0),
    };
  });

  const aging = [
    { label: "Current", total: 0, count: 0 },
    { label: "0-30d", total: 0, count: 0 },
    { label: "31-60d", total: 0, count: 0 },
    { label: "61-90d", total: 0, count: 0 },
    { label: "90+d", total: 0, count: 0 },
  ];

  for (const invoice of invoices) {
    if (invoice.balance_amount <= 0) continue;

    let index = 0;
    if (invoice.age_days > 90) index = 4;
    else if (invoice.age_days > 60) index = 3;
    else if (invoice.age_days > 30) index = 2;
    else if (invoice.age_days > 0) index = 1;

    aging[index].total += invoice.balance_amount;
    aging[index].count += 1;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description="Allocate receipts, capture deductions and keep invoice balances visible."
      />
      <FinanceWorkspace invoices={invoices} payments={payments} deductions={deductions} aging={aging} poLines={poLines} canWrite={canWrite} />
    </div>
  );
}
