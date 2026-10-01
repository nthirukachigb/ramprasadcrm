"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { ComparableHistory } from "@/components/history/ComparableHistory";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  addTaxLine,
  approveQuotation,
  createQuotationRevision,
  deleteTaxLine,
  recordQuotationSubmission,
  saveQuotationHeader,
  submitQuotation,
  updateQuotationLine,
} from "@/lib/actions/quotation";
import { linePricing } from "@/lib/calc/pricing";
import { formatINR, formatQty } from "@/lib/format";
import {
  QUOTATION_STATUS_LABELS,
  SOURCING_BASIS_OPTIONS,
  VERSION_REASON_LABELS,
  VERSION_REASONS,
} from "@/lib/schemas/quotation";

export interface QuotationLineRow {
  id: string;
  requirement_line_id: string;
  line_no: number;
  description: string;
  qty_quoted: number;
  uom: string;
  unit_cost: number | null;
  freight_unit: number | null;
  other_cost_unit: number | null;
  target_margin_pct: number | null;
  proposed_unit_price: number | null;
  lead_time_days: number | null;
  sourcing_basis: string | null;
  notes: string | null;
}
export interface TaxRow {
  id: string;
  tax_type: string;
  rate_pct: number | null;
  taxable_amount: number | null;
  amount: number;
}
export interface QuotationHeaderRow {
  id: string;
  version_no: number;
  version_reason: string;
  status: string;
  currency: string;
  fx_rate: number;
  valid_until: string | null;
  delivery_terms: string | null;
  payment_terms: string | null;
  technical_compliance_declared: boolean;
  commercial_compliance_declared: boolean;
}
export interface QuotationTotalsRow {
  line_count: number;
  net_amount: number;
  cost_amount: number;
  tax_amount: number;
  gross_amount: number;
  margin_pct: number | null;
}

export function QuotationWorkspace({
  version,
  quotation,
  lines,
  taxes,
  totals,
  gateErrors,
  canWrite,
  canApprove,
}: {
  version: QuotationHeaderRow;
  quotation: { id: string; internal_quote_no: string; requirementId: string; requirement_ref: string };
  lines: QuotationLineRow[];
  taxes: TaxRow[];
  totals: QuotationTotalsRow;
  gateErrors: string[];
  canWrite: boolean;
  canApprove: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [comment, setComment] = useState("");
  const [revisionReason, setRevisionReason] = useState("revised");
  const [submission, setSubmission] = useState({
    mode: "email",
    at: new Date().toISOString().slice(0, 16),
    reference: "",
    lateReason: "",
  });
  const [error, setError] = useState<string | null>(null);

  const locked = version.status !== "draft";

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string, close?: () => void) {
    setBusy(true);
    setError(null);
    const result = await fn();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    toast.success(success);
    close?.();
    router.refresh();
  }

  const preview = lines.reduce(
    (acc, line) => {
      const priced = linePricing({
        qtyQuoted: Number(line.qty_quoted),
        unitCost: line.unit_cost,
        freightUnit: line.freight_unit,
        otherCostUnit: line.other_cost_unit,
        proposedUnitPrice: line.proposed_unit_price,
      });
      acc.net += priced.netAmount;
      acc.cost += priced.costAmount;
      return acc;
    },
    { net: 0, cost: 0 },
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium">{quotation.internal_quote_no}</span>
        <Badge variant="secondary">v{version.version_no}</Badge>
        <Badge
          className={
            version.status === "approved" || version.status === "submitted"
              ? "border-transparent bg-emerald-100 text-emerald-800"
              : version.status === "pending_approval"
                ? "border-transparent bg-amber-100 text-amber-900"
                : undefined
          }
        >
          {QUOTATION_STATUS_LABELS[version.status] ?? version.status}
        </Badge>
        <span className="text-muted-foreground text-sm">
          {VERSION_REASON_LABELS[version.version_reason] ?? version.version_reason}
        </span>
        <span className="ml-auto flex flex-wrap gap-2">
          {canWrite && version.status === "draft" ? (
            <Button size="sm" onClick={() => setSubmitOpen(true)}>
              <Send className="size-4" aria-hidden="true" />
              Submit for approval
            </Button>
          ) : null}
          {canApprove && version.status === "pending_approval" ? (
            <Button size="sm" onClick={() => setApproveOpen(true)}>
              Approve
            </Button>
          ) : null}
          {canWrite &&
          ["approved", "submitted", "rejected"].includes(version.status) ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setRevisionOpen(true)}>
                Create revision
              </Button>
              {version.status === "approved" ? (
                <Button size="sm" onClick={() => setSubmitOpen(true)}>
                  Record submission
                </Button>
              ) : null}
            </>
          ) : null}
        </span>
      </div>

      {version.status === "pending_approval" ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Waiting for Owner approval.
        </p>
      ) : null}

      {gateErrors.length > 0 ? (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          <p className="font-medium">This version cannot be approved yet:</p>
          <ul className="mt-1 list-disc pl-5">
            {gateErrors.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Summary label="Net" value={formatINR(totals.net_amount)} />
        <Summary label="Cost" value={formatINR(totals.cost_amount)} />
        <Summary
          label="Margin"
          value={totals.margin_pct != null ? `${Number(totals.margin_pct).toFixed(2)}%` : "—"}
        />
        <Summary label="Tax" value={formatINR(totals.tax_amount)} />
        <Summary label="Gross" value={formatINR(totals.gross_amount)} />
        <Summary label="Lines" value={String(totals.line_count)} />
      </div>
      <p className="text-muted-foreground text-xs">
        These figures come from <code>v_quotation_totals</code> (the database is
        authoritative). Live preview while editing: net {formatINR(preview.net)},
        cost {formatINR(preview.cost)}.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lines</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {lines.length === 0 ? (
            <p className="text-muted-foreground text-sm">No lines.</p>
          ) : (
            lines.map((line) => (
              <QuotationLineEditor
                key={line.id}
                line={line}
                versionId={version.id}
                locked={locked || !canWrite}
              />
            ))
          )}
        </CardContent>
      </Card>

      <HeaderForm
        version={version}
        canWrite={canWrite && version.status === "draft"}
        onSave={(payload) =>
          run(() => saveQuotationHeader(payload), "Quotation header saved.")
        }
        busy={busy}
      />

      <TaxLines
        versionId={version.id}
        taxes={taxes}
        canWrite={canWrite && version.status === "draft"}
        onAdd={(payload) => run(() => addTaxLine(payload), "Tax line added.")}
        onDelete={(id) => run(() => deleteTaxLine({ id, versionId: version.id }), "Tax line removed.")}
        busy={busy}
      />

      {/* Submit / approve / revision / submission dialogs */}
      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {version.status === "approved" ? "Record submission" : "Submit for approval"}
            </DialogTitle>
            <DialogDescription>
              {version.status === "approved"
                ? "Record how and when the quotation was submitted. A late submission needs a reason."
                : "The gate is re-checked. The Owner approves in the approvals inbox."}
            </DialogDescription>
          </DialogHeader>
          {version.status === "approved" ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="mode">Mode</Label>
                  <Input
                    id="mode"
                    value={submission.mode}
                    onChange={(e) => setSubmission({ ...submission, mode: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="at">Submitted at</Label>
                  <Input
                    id="at"
                    type="datetime-local"
                    value={submission.at}
                    onChange={(e) => setSubmission({ ...submission, at: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ref">Reference / acknowledgement</Label>
                <Input
                  id="ref"
                  value={submission.reference}
                  onChange={(e) => setSubmission({ ...submission, reference: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="late">Late reason (if after the deadline)</Label>
                <Textarea
                  id="late"
                  rows={2}
                  value={submission.lateReason}
                  onChange={(e) => setSubmission({ ...submission, lateReason: e.target.value })}
                />
              </div>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={() =>
                version.status === "approved"
                  ? run(
                      () =>
                        recordQuotationSubmission({
                          versionId: version.id,
                          mode: submission.mode,
                          at: submission.at,
                          reference: submission.reference,
                          lateReason: submission.lateReason,
                        }),
                      "Submission recorded.",
                      () => setSubmitOpen(false),
                    )
                  : run(
                      () => submitQuotation({ versionId: version.id }),
                      "Submitted for approval.",
                      () => setSubmitOpen(false),
                    )
              }
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve quotation</DialogTitle>
            <DialogDescription>
              Approving locks this version and makes it the current version.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            rows={3}
            placeholder="Approval comment (required)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              disabled={busy || comment.trim().length < 3}
              onClick={() =>
                run(
                  () => approveQuotation({ versionId: version.id, comment }),
                  "Quotation approved.",
                  () => setApproveOpen(false),
                )
              }
            >
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
              Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={revisionOpen} onOpenChange={setRevisionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create revision</DialogTitle>
            <DialogDescription>
              Copies the lines into a new draft version. Earlier versions stay retrievable.
            </DialogDescription>
          </DialogHeader>
          <select
            value={revisionReason}
            onChange={(e) => setRevisionReason(e.target.value)}
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
          >
            {VERSION_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {VERSION_REASON_LABELS[reason] ?? reason}
              </option>
            ))}
          </select>
          {error ? (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                const result = await createQuotationRevision({
                  versionId: version.id,
                  reason: revisionReason,
                });
                setBusy(false);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                toast.success("Revision created.");
                setRevisionOpen(false);
                if (result.id) router.push(`/quotations/${result.id}`);
                else router.refresh();
              }}
            >
              Create revision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-muted-foreground text-xs">{label}</p>
        <p className="text-lg font-medium">{value}</p>
      </CardContent>
    </Card>
  );
}

function QuotationLineEditor({
  line,
  versionId,
  locked,
}: {
  line: QuotationLineRow;
  versionId: string;
  locked: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [values, setValues] = useState({
    unitCost: line.unit_cost?.toString() ?? "",
    freightUnit: line.freight_unit?.toString() ?? "",
    otherCostUnit: line.other_cost_unit?.toString() ?? "",
    targetMarginPct: line.target_margin_pct?.toString() ?? "",
    proposedUnitPrice: line.proposed_unit_price?.toString() ?? "",
    leadTimeDays: line.lead_time_days?.toString() ?? "",
    sourcingBasis: line.sourcing_basis ?? "",
    notes: line.notes ?? "",
  });
  const [error, setError] = useState<string | null>(null);

  const priced = linePricing({
    qtyQuoted: Number(line.qty_quoted),
    unitCost: values.unitCost === "" ? null : Number(values.unitCost),
    freightUnit: values.freightUnit === "" ? null : Number(values.freightUnit),
    otherCostUnit: values.otherCostUnit === "" ? null : Number(values.otherCostUnit),
    proposedUnitPrice: values.proposedUnitPrice === "" ? null : Number(values.proposedUnitPrice),
  });

  async function save() {
    setBusy(true);
    setError(null);
    const result = await updateQuotationLine({
      lineId: line.id,
      versionId,
      unitCost: values.unitCost,
      freightUnit: values.freightUnit,
      otherCostUnit: values.otherCostUnit,
      targetMarginPct: values.targetMarginPct,
      proposedUnitPrice: values.proposedUnitPrice,
      leadTimeDays: values.leadTimeDays,
      sourcingBasis: values.sourcingBasis,
      notes: values.notes,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success(`Line ${line.line_no} saved.`);
    router.refresh();
  }

  const suggestedPrice =
    values.targetMarginPct !== "" &&
    Number(values.targetMarginPct) < 100 &&
    priced.landedUnitCost > 0
      ? Math.round(
          (priced.landedUnitCost / (1 - Number(values.targetMarginPct) / 100)) * 10000,
        ) / 10000
      : null;

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">
          #{line.line_no} {line.description}
        </span>
        <span className="text-muted-foreground">
          {formatQty(line.qty_quoted)} {line.uom}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <ComparableHistory lineId={line.requirement_line_id} />
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Num label="OEM cost" value={values.unitCost} onChange={(v) => setValues({ ...values, unitCost: v })} disabled={locked} />
        <Num label="Freight/unit" value={values.freightUnit} onChange={(v) => setValues({ ...values, freightUnit: v })} disabled={locked} />
        <Num label="Other/unit" value={values.otherCostUnit} onChange={(v) => setValues({ ...values, otherCostUnit: v })} disabled={locked} />
        <Num label="Target margin %" value={values.targetMarginPct} onChange={(v) => setValues({ ...values, targetMarginPct: v })} disabled={locked} />
        <Num label="Proposed price" value={values.proposedUnitPrice} onChange={(v) => setValues({ ...values, proposedUnitPrice: v })} disabled={locked} />
        <Num label="Lead time (days)" value={values.leadTimeDays} onChange={(v) => setValues({ ...values, leadTimeDays: v })} disabled={locked} />
        <div className="space-y-1">
          <Label className="text-xs">Sourcing basis</Label>
          <select
            value={values.sourcingBasis}
            disabled={locked}
            onChange={(e) => setValues({ ...values, sourcingBasis: e.target.value })}
            className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm disabled:opacity-60"
          >
            <option value="">— select —</option>
            {SOURCING_BASIS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        {suggestedPrice !== null ? (
          <div className="space-y-1">
            <Label className="text-xs">Suggestion</Label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={locked}
              onClick={() => setValues({ ...values, proposedUnitPrice: String(suggestedPrice) })}
            >
              Apply {formatINR(suggestedPrice)}
            </Button>
          </div>
        ) : null}
      </div>

      <p className="text-muted-foreground text-xs">
        Landed unit cost {formatINR(priced.landedUnitCost)} · margin{" "}
        {priced.marginPct != null ? `${priced.marginPct.toFixed(2)}%` : "—"} · line net{" "}
        {formatINR(priced.netAmount)}
      </p>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      {!locked ? (
        <Button size="sm" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
          Save line
        </Button>
      ) : (
        <p className="text-muted-foreground text-xs">Locked — create a revision to change it.</p>
      )}
    </div>
  );
}

function Num({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        step="any"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="h-9"
      />
    </div>
  );
}

function HeaderForm({
  version,
  canWrite,
  onSave,
  busy,
}: {
  version: QuotationHeaderRow;
  canWrite: boolean;
  onSave: (payload: Record<string, unknown>) => void;
  busy: boolean;
}) {
  const [values, setValues] = useState({
    currency: version.currency,
    fxRate: String(version.fx_rate),
    validUntil: version.valid_until ?? "",
    deliveryTerms: version.delivery_terms ?? "",
    paymentTerms: version.payment_terms ?? "",
    technical: version.technical_compliance_declared,
    commercial: version.commercial_compliance_declared,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Terms and compliance</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="currency">Currency</Label>
          <Input id="currency" value={values.currency} disabled={!canWrite} onChange={(e) => setValues({ ...values, currency: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fx">FX rate</Label>
          <Input id="fx" type="number" step="any" value={values.fxRate} disabled={!canWrite} onChange={(e) => setValues({ ...values, fxRate: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="valid">Valid until</Label>
          <Input id="valid" type="date" value={values.validUntil} disabled={!canWrite} onChange={(e) => setValues({ ...values, validUntil: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="delivery">Delivery terms</Label>
          <Input id="delivery" value={values.deliveryTerms} disabled={!canWrite} onChange={(e) => setValues({ ...values, deliveryTerms: e.target.value })} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="payment">Payment terms</Label>
          <Textarea id="payment" rows={2} value={values.paymentTerms} disabled={!canWrite} onChange={(e) => setValues({ ...values, paymentTerms: e.target.value })} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={values.technical} disabled={!canWrite} onChange={(e) => setValues({ ...values, technical: e.target.checked })} />
          Technical compliance declared
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" checked={values.commercial} disabled={!canWrite} onChange={(e) => setValues({ ...values, commercial: e.target.checked })} />
          Commercial compliance declared
        </label>
        {canWrite ? (
          <div className="sm:col-span-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                onSave({
                  versionId: version.id,
                  currency: values.currency,
                  fxRate: values.fxRate,
                  validUntil: values.validUntil,
                  deliveryTerms: values.deliveryTerms,
                  paymentTerms: values.paymentTerms,
                  technicalCompliance: values.technical,
                  commercialCompliance: values.commercial,
                })
              }
            >
              Save terms & compliance
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TaxLines({
  versionId,
  taxes,
  canWrite,
  onAdd,
  onDelete,
  busy,
}: {
  versionId: string;
  taxes: TaxRow[];
  canWrite: boolean;
  onAdd: (payload: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
  busy: boolean;
}) {
  const [type, setType] = useState("GST");
  const [rate, setRate] = useState("18");
  const [amount, setAmount] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tax lines</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {taxes.length === 0 ? (
          <p className="text-muted-foreground text-sm">No tax lines.</p>
        ) : (
          <ul className="divide-y rounded-lg border text-sm">
            {taxes.map((tax) => (
              <li key={tax.id} className="flex items-center gap-3 p-2">
                <span>{tax.tax_type}</span>
                <span className="text-muted-foreground">
                  {tax.rate_pct != null ? `${tax.rate_pct}%` : ""}
                </span>
                <span className="ml-auto">{formatINR(tax.amount)}</span>
                {canWrite ? (
                  <Button size="icon" variant="ghost" onClick={() => onDelete(tax.id)} aria-label="Remove tax line">
                    <Trash2 className="size-4" aria-hidden="true" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canWrite ? (
          <div className="grid gap-2 sm:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs">Type</Label>
              <Input value={type} onChange={(e) => setType(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Rate %</Label>
              <Input type="number" step="any" value={rate} onChange={(e) => setRate(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Amount</Label>
              <Input type="number" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9" />
            </div>
            <div className="flex items-end">
              <Button
                size="sm"
                disabled={busy || amount === ""}
                onClick={() => {
                  onAdd({ versionId, taxType: type, ratePct: rate, amount });
                  setAmount("");
                }}
              >
                Add tax
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
