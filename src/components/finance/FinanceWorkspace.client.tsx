"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Receipt, Wallet } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createInvoice, createPayment, recordDeduction } from "@/lib/actions/finance";
import { formatDate, formatQty } from "@/lib/format";

export interface FinanceInvoiceRow {
  id: string;
  invoice_number: string;
  customer_po_id: string;
  gross_amount: number;
  tax_amount: number;
  paid_amount: number;
  deduction_amount: number;
  balance_amount: number;
  status: string;
  invoice_date: string;
  due_date: string | null;
  age_days: number;
}

export interface FinanceDeductionRow {
  id: string;
  invoice_id: string;
  invoice_number: string;
  deduction_type: string;
  amount: number;
  status: string;
  notes: string | null;
}

export interface FinancePaymentRow {
  id: string;
  payment_date: string;
  amount: number;
  mode: string | null;
  reference_no: string | null;
}

export interface FinancePoLineOption {
  id: string;
  customer_po_id: string;
  po_ref: string;
  line_no: number;
  description: string;
  qty_ordered: number;
}

export interface AgingBucket {
  label: string;
  total: number;
  count: number;
}

export function FinanceWorkspace({
  invoices,
  payments,
  deductions,
  aging,
  poLines,
  canWrite,
}: {
  invoices: FinanceInvoiceRow[];
  payments: FinancePaymentRow[];
  deductions: FinanceDeductionRow[];
  aging: AgingBucket[];
  poLines: FinancePoLineOption[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const totalOutstanding = invoices.reduce((sum, invoice) => sum + invoice.balance_amount, 0);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setBusy(true);
    setError(null);
    const result = await fn();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    toast.success(success);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {aging.map((bucket) => (
          <div key={bucket.label} className="rounded-md border p-3">
            <p className="text-muted-foreground text-xs">{bucket.label}</p>
            <p className="mt-2 text-lg font-semibold">{formatQty(bucket.total)}</p>
            <p className="text-muted-foreground text-xs">{bucket.count} invoice(s)</p>
          </div>
        ))}
        <div className="rounded-md border p-3 bg-amber-50">
          <p className="text-muted-foreground text-xs">Outstanding</p>
          <p className="mt-2 text-lg font-semibold">{formatQty(totalOutstanding)}</p>
          <p className="text-muted-foreground text-xs">Across open invoices</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoice register</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {invoices.length === 0 ? (
            <p className="text-muted-foreground text-sm">No invoices captured yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {invoices.map((invoice) => (
                <li key={invoice.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                  <Badge variant="secondary">{invoice.status}</Badge>
                  <span className="font-medium">{invoice.invoice_number}</span>
                  <span className="text-muted-foreground">
                    {formatDate(invoice.invoice_date)} · due {invoice.due_date ? formatDate(invoice.due_date) : "—"}
                  </span>
                  <span className="text-muted-foreground">
                    {formatQty(invoice.gross_amount)} gross · {formatQty(invoice.tax_amount)} tax
                  </span>
                  <span className="text-muted-foreground">
                    paid {formatQty(invoice.paid_amount)} · deductions {formatQty(invoice.deduction_amount)} · balance {formatQty(invoice.balance_amount)}
                  </span>
                  <span className="text-muted-foreground">{invoice.age_days}d age</span>
                </li>
              ))}
            </ul>
          )}

          {canWrite ? (
            <form
              className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-2"
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                run(
                  () =>
                    createInvoice({
                      invoiceNumber: String(form.get("invoiceNumber") ?? ""),
                      poLineId: String(form.get("poLineId") ?? ""),
                      invoiceDate: String(form.get("invoiceDate") ?? "") || undefined,
                      dueDate: String(form.get("dueDate") ?? "") || undefined,
                      qty: Number(form.get("qty") ?? 0),
                      unitRate: Number(form.get("unitRate") ?? 0),
                      taxRate: Number(form.get("taxRate") ?? 0),
                      notes: String(form.get("notes") ?? "") || null,
                    }),
                  "Invoice created.",
                );
              }}
            >
              <div className="space-y-1">
                <Label className="text-xs">PO line</Label>
                <select name="poLineId" required className="border-input bg-background h-9 rounded-md border px-2 text-sm">
                  {poLines.map((line) => (
                    <option key={line.id} value={line.id}>
                      {line.po_ref} · #{line.line_no} {line.description}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Invoice no</Label>
                <Input name="invoiceNumber" required className="h-9 w-36" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Qty</Label>
                <Input name="qty" type="number" step="any" required className="h-9 w-24" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Rate</Label>
                <Input name="unitRate" type="number" step="any" required className="h-9 w-24" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tax %</Label>
                <Input name="taxRate" type="number" step="any" defaultValue={0} className="h-9 w-20" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Invoice date</Label>
                <Input name="invoiceDate" type="date" className="h-9 w-36" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Due date</Label>
                <Input name="dueDate" type="date" className="h-9 w-36" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Notes</Label>
                <Textarea name="notes" className="h-9 w-52" />
              </div>
              <Button size="sm" type="submit" disabled={busy}>
                <Plus className="size-4" aria-hidden="true" />
                Add invoice
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Deductions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {deductions.length === 0 ? (
            <p className="text-muted-foreground text-sm">No deductions logged.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {deductions.map((deduction) => (
                <li key={deduction.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                  <Badge variant="secondary">{deduction.status}</Badge>
                  <span className="font-medium">{deduction.invoice_number}</span>
                  <span className="text-muted-foreground">{deduction.deduction_type}</span>
                  <span className="text-muted-foreground">{formatQty(deduction.amount)}</span>
                  {deduction.notes ? <span className="text-muted-foreground">{deduction.notes}</span> : null}
                </li>
              ))}
            </ul>
          )}

          {canWrite ? (
            <form
              className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-2"
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                run(
                  () =>
                    recordDeduction({
                      invoiceId: String(form.get("invoiceId") ?? ""),
                      type: String(form.get("type") ?? "misc"),
                      amount: Number(form.get("amount") ?? 0),
                      status: String(form.get("status") ?? "proposed"),
                      notes: String(form.get("notes") ?? "") || null,
                    }),
                  "Deduction recorded.",
                );
              }}
            >
              <div className="space-y-1">
                <Label className="text-xs">Invoice</Label>
                <select name="invoiceId" required className="border-input bg-background h-9 rounded-md border px-2 text-sm">
                  {invoices.map((invoice) => (
                    <option key={invoice.id} value={invoice.id}>
                      {invoice.invoice_number}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <Input name="type" defaultValue="misc" className="h-9 w-32" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Amount</Label>
                <Input name="amount" type="number" step="any" required className="h-9 w-28" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Status</Label>
                <select name="status" defaultValue="proposed" className="border-input bg-background h-9 rounded-md border px-2 text-sm w-32">
                  <option value="proposed">proposed</option>
                  <option value="approved">approved</option>
                  <option value="disputed">disputed</option>
                  <option value="settled">settled</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Notes</Label>
                <Textarea name="notes" className="h-9 w-52" />
              </div>
              <Button size="sm" type="submit" disabled={busy}>
                <Plus className="size-4" aria-hidden="true" />
                Add deduction
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {payments.length === 0 ? (
            <p className="text-muted-foreground text-sm">No payments allocated yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {payments.map((payment) => (
                <li key={payment.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                  <Wallet className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="font-medium">{formatQty(payment.amount)}</span>
                  <span className="text-muted-foreground">{payment.mode ?? "bank_transfer"}</span>
                  <span className="text-muted-foreground">{formatDate(payment.payment_date)}</span>
                  {payment.reference_no ? <span className="text-muted-foreground">Ref {payment.reference_no}</span> : null}
                </li>
              ))}
            </ul>
          )}

          {canWrite ? (
            <form
              className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-2"
              onSubmit={(e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                run(
                  () =>
                    createPayment({
                      invoiceId: String(form.get("invoiceId") ?? ""),
                      amount: Number(form.get("amount") ?? 0),
                      paymentDate: String(form.get("paymentDate") ?? "") || undefined,
                      mode: String(form.get("mode") ?? "cash"),
                      reference: String(form.get("reference") ?? "") || undefined,
                      notes: String(form.get("notes") ?? "") || null,
                    }),
                  "Payment recorded.",
                );
              }}
            >
              <div className="space-y-1">
                <Label className="text-xs">Invoice</Label>
                <select name="invoiceId" required className="border-input bg-background h-9 rounded-md border px-2 text-sm">
                  {invoices.map((invoice) => (
                    <option key={invoice.id} value={invoice.id}>
                      {invoice.invoice_number}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Amount</Label>
                <Input name="amount" type="number" step="any" required className="h-9 w-28" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Mode</Label>
                <Input name="mode" defaultValue="bank_transfer" className="h-9 w-32" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Ref</Label>
                <Input name="reference" className="h-9 w-32" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Date</Label>
                <Input name="paymentDate" type="date" className="h-9 w-36" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Notes</Label>
                <Textarea name="notes" className="h-9 w-52" />
              </div>
              <Button size="sm" type="submit" disabled={busy}>
                <Receipt className="size-4" aria-hidden="true" />
                Record payment
              </Button>
            </form>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
