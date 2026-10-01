"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save } from "lucide-react";
import { toast } from "sonner";

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
  applyPoAmendment,
  createPoAmendment,
  createSupplierPo,
  resolvePoMismatch,
  savePoSchedule,
  transitionPo,
  updatePoLine,
} from "@/lib/actions/po";
import { formatDate, formatINR, formatQty } from "@/lib/format";

const PO_STATUS_LABELS: Record<string, string> = {
  received: "Received",
  under_review: "Under review",
  acknowledged: "Acknowledged",
  amended: "Amended",
  completed: "Completed",
  cancelled: "Cancelled",
};
const PO_NEXT: Record<string, string[]> = {
  received: ["under_review", "cancelled"],
  under_review: ["acknowledged", "cancelled"],
  acknowledged: ["amended", "completed", "cancelled"],
  amended: ["acknowledged", "completed", "cancelled"],
};

export interface PoLineRow {
  id: string;
  line_no: number;
  description: string;
  qty_ordered: number;
  qty_ordered_effective: number;
  unit_rate: number;
  uom: string;
  schedules: { id: string; sequence: number; qty: number; due_date: string | null }[];
}
export interface PoMismatchRow {
  id: string;
  po_line_id: string | null;
  field: string;
  quoted_value: string | null;
  po_value: string | null;
  severity: string;
  resolution: string;
  approval_id: string | null;
  approval_decision: string | null;
}
export interface PoAmendmentRow {
  id: string;
  amendment_no: number;
  status: string;
  reason: string | null;
  changes: { field: string; old_value: string | null; new_value: string | null }[];
}
export interface SupplierPoRow {
  id: string;
  internal_ref: string | null;
  partner_name: string | null;
  status: string;
}

export function PoWorkspace({
  po,
  lines,
  mismatches,
  amendments,
  supplierPos,
  partners,
  canWrite,
}: {
  po: {
    id: string;
    internal_ref: string | null;
    customer_po_number: string;
    status: string;
    po_date: string | null;
    payment_terms: string | null;
    delivery_terms: string | null;
    pdi_required: boolean;
    notes: string | null;
    customer_name: string;
    requirement_ref: string;
    version_no: number;
  };
  lines: PoLineRow[];
  mismatches: PoMismatchRow[];
  amendments: PoAmendmentRow[];
  supplierPos: SupplierPoRow[];
  partners: { id: string; name: string }[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduleFor, setScheduleFor] = useState<PoLineRow | null>(null);
  const [scheduleRows, setScheduleRows] = useState<{ qty: string; dueDate: string }[]>([]);
  const [amendmentOpen, setAmendmentOpen] = useState(false);
  const [supplierOpen, setSupplierOpen] = useState(false);

  async function run(
    fn: () => Promise<{ ok: boolean; error?: string; id?: string }>,
    success: string,
    close?: () => void,
  ) {
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

  const blocking = mismatches.filter(
    (m) =>
      ["medium", "high"].includes(m.severity) &&
      m.resolution === "open",
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="secondary">{PO_STATUS_LABELS[po.status] ?? po.status}</Badge>
        <span className="text-muted-foreground text-sm">
          {po.customer_name} · PO {po.customer_po_number} · quote v{po.version_no}
        </span>
        {po.pdi_required ? <Badge variant="secondary">PDI required</Badge> : null}
        {canWrite ? (
          <span className="ml-auto flex flex-wrap gap-2">
            {(PO_NEXT[po.status] ?? []).map((next) => (
              <Button
                key={next}
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run(
                    () => transitionPo({ id: po.id, toStatus: next as never }),
                    `Moved to ${PO_STATUS_LABELS[next] ?? next}.`,
                  )
                }
              >
                {PO_STATUS_LABELS[next] ?? next}
              </Button>
            ))}
          </span>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Variances</CardTitle>
        </CardHeader>
        <CardContent>
          {mismatches.length === 0 ? (
            <p className="text-muted-foreground text-sm">No variances — the PO matches the quotation.</p>
          ) : (
            <>
              {blocking > 0 ? (
                <p className="mb-2 rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-900">
                  {blocking} unresolved variance(s) block acknowledgement.
                </p>
              ) : null}
              <ul className="divide-y rounded-lg border text-sm">
                {mismatches.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2 p-2">
                    <Badge
                      className={
                        m.severity === "high"
                          ? "border-transparent bg-red-100 text-red-800"
                          : m.severity === "medium"
                            ? "border-transparent bg-amber-100 text-amber-900"
                            : undefined
                      }
                    >
                      {m.severity}
                    </Badge>
                    <span className="font-medium capitalize">{m.field.replace(/_/g, " ")}</span>
                    <span className="text-muted-foreground">
                      quoted {m.quoted_value ?? "—"} → PO {m.po_value ?? "—"}
                    </span>
                    <span className="text-muted-foreground">{m.resolution}</span>
                    {canWrite && m.resolution === "open" ? (
                      <span className="ml-auto flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            run(
                              () =>
                                resolvePoMismatch({
                                  id: m.id,
                                  customerPoId: po.id,
                                  resolution: "accepted",
                                  reason: "Owner accepted",
                                }),
                              "Variance accepted (pending approval).",
                            )
                          }
                        >
                          Accept
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            run(
                              () =>
                                resolvePoMismatch({
                                  id: m.id,
                                  customerPoId: po.id,
                                  resolution: "amendment_requested",
                                }),
                              "Amendment requested.",
                            )
                          }
                        >
                          Amendment
                        </Button>
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Lines and delivery schedule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {lines.map((line) => (
            <LineEditor
              key={line.id}
              line={line}
              poId={po.id}
              canWrite={canWrite}
              onEdit={run}
              onSchedule={() => {
                setScheduleFor(line);
                setScheduleRows(
                  line.schedules.length > 0
                    ? line.schedules.map((s) => ({ qty: String(s.qty), dueDate: s.due_date ?? "" }))
                    : [{ qty: String(line.qty_ordered_effective), dueDate: "" }],
                );
              }}
            />
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Amendments</CardTitle>
          {canWrite ? (
            <Button size="sm" variant="outline" onClick={() => setAmendmentOpen(true)}>
              New amendment
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {amendments.length === 0 ? (
            <p className="text-muted-foreground text-sm">No amendments.</p>
          ) : (
            <ul className="divide-y rounded-lg border text-sm">
              {amendments.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2 p-2">
                  <span className="font-medium">#{a.amendment_no}</span>
                  <Badge variant="secondary">{a.status}</Badge>
                  {a.changes.map((c, i) => (
                    <span key={i} className="text-muted-foreground">
                      {c.field}: {c.old_value} → {c.new_value}
                    </span>
                  ))}
                  {canWrite && a.status === "draft" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => applyPoAmendment({ amendmentId: a.id, customerPoId: po.id }),
                          "Amendment applied.",
                        )
                      }
                    >
                      Apply
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Supplier POs</CardTitle>
          {canWrite ? (
            <Button size="sm" variant="outline" onClick={() => setSupplierOpen(true)}>
              New supplier PO
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {supplierPos.length === 0 ? (
            <p className="text-muted-foreground text-sm">No supplier POs.</p>
          ) : (
            <ul className="divide-y rounded-lg border text-sm">
              {supplierPos.map((s) => (
                <li key={s.id} className="flex items-center gap-2 p-2">
                  <span className="font-medium">{s.internal_ref ?? s.id.slice(0, 8)}</span>
                  <span>{s.partner_name ?? "—"}</span>
                  <Badge variant="secondary">{s.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Schedule dialog */}
      <Dialog open={scheduleFor !== null} onOpenChange={(o) => !o && setScheduleFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delivery schedule</DialogTitle>
            <DialogDescription>
              Where schedule rows exist their quantities must equal the ordered quantity.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {scheduleRows.map((row, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  type="number"
                  step="any"
                  placeholder="Qty"
                  value={row.qty}
                  onChange={(e) =>
                    setScheduleRows((rows) =>
                      rows.map((r, i) => (i === index ? { ...r, qty: e.target.value } : r)),
                    )
                  }
                />
                <Input
                  type="date"
                  value={row.dueDate}
                  onChange={(e) =>
                    setScheduleRows((rows) =>
                      rows.map((r, i) => (i === index ? { ...r, dueDate: e.target.value } : r)),
                    )
                  }
                />
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setScheduleRows((rows) => rows.filter((_, i) => i !== index))}
                >
                  ×
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setScheduleRows((rows) => [...rows, { qty: "", dueDate: "" }])}
            >
              <Plus className="size-4" aria-hidden="true" /> Add row
            </Button>
          </div>
          <DialogFooter>
            <Button
              disabled={busy || scheduleFor === null}
              onClick={() =>
                scheduleFor &&
                run(
                  () =>
                    savePoSchedule({
                      poLineId: scheduleFor.id,
                      customerPoId: po.id,
                      rows: scheduleRows
                        .filter((r) => Number(r.qty) > 0)
                        .map((r) => ({ qty: Number(r.qty), dueDate: r.dueDate || null })),
                    }),
                  "Schedule saved.",
                  () => setScheduleFor(null),
                )
              }
            >
              Save schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Amendment dialog */}
      <Dialog open={amendmentOpen} onOpenChange={setAmendmentOpen}>
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const lineId = String(form.get("lineId"));
              const line = lines.find((l) => l.id === lineId);
              if (!line) return;
              run(
                () =>
                  createPoAmendment({
                    customerPoId: po.id,
                    reason: String(form.get("reason") ?? ""),
                    changes: [
                      {
                        poLineId: lineId,
                        field: "qty",
                        oldValue: String(line.qty_ordered_effective),
                        newValue: String(form.get("newQty")),
                      },
                    ],
                  }),
                "Amendment recorded.",
                () => setAmendmentOpen(false),
              );
            }}
            className="space-y-3"
          >
            <DialogHeader>
              <DialogTitle>New amendment</DialogTitle>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label>Line</Label>
              <select name="lineId" required className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm">
                {lines.map((l) => (
                  <option key={l.id} value={l.id}>
                    #{l.line_no} {l.description}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newQty">New quantity</Label>
              <Input id="newQty" name="newQty" type="number" step="any" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reason">Reason</Label>
              <Textarea id="reason" name="reason" rows={2} />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy}>
                Save amendment
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Supplier PO dialog */}
      <Dialog open={supplierOpen} onOpenChange={setSupplierOpen}>
        <DialogContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const poLineId = String(form.get("poLineId"));
              run(
                () =>
                  createSupplierPo({
                    customerPoId: po.id,
                    partnerId: String(form.get("partnerId")),
                    lines: [{ poLineId, qty: Number(form.get("qty")), unitCost: Number(form.get("unitCost")) || undefined }],
                  }),
                "Supplier PO created.",
                () => setSupplierOpen(false),
              );
            }}
            className="space-y-3"
          >
            <DialogHeader>
              <DialogTitle>New supplier PO</DialogTitle>
              <DialogDescription>
                The partner must be the approved OEM selection for the line, or an owner approval is required.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label>Partner</Label>
              <select name="partnerId" required className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm">
                {partners.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Customer PO line</Label>
              <select name="poLineId" required className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm">
                {lines.map((l) => (
                  <option key={l.id} value={l.id}>
                    #{l.line_no} {l.description}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="qty">Quantity</Label>
                <Input id="qty" name="qty" type="number" step="any" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="unitCost">Unit cost</Label>
                <Input id="unitCost" name="unitCost" type="number" step="any" />
              </div>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy}>
                Create supplier PO
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function LineEditor({
  line,
  poId,
  canWrite,
  onEdit,
  onSchedule,
}: {
  line: PoLineRow;
  poId: string;
  canWrite: boolean;
  onEdit: (
    fn: () => Promise<{ ok: boolean; error?: string }>,
    success: string,
  ) => void;
  onSchedule: () => void;
}) {
  const [values, setValues] = useState({
    qty: String(line.qty_ordered),
    rate: String(line.unit_rate),
    uom: line.uom,
  });

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">
          #{line.line_no} {line.description}
        </span>
        <span className="text-muted-foreground">
          scheduled {line.schedules.length} delivery(ies)
        </span>
        {canWrite ? (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={onSchedule}>
            Schedule
          </Button>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="space-y-1">
          <Label className="text-xs">Ordered qty</Label>
          <Input type="number" step="any" value={values.qty} disabled={!canWrite} onChange={(e) => setValues({ ...values, qty: e.target.value })} className="h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Unit rate</Label>
          <Input type="number" step="any" value={values.rate} disabled={!canWrite} onChange={(e) => setValues({ ...values, rate: e.target.value })} className="h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">UoM</Label>
          <Input value={values.uom} disabled={!canWrite} onChange={(e) => setValues({ ...values, uom: e.target.value })} className="h-9" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Effective</Label>
          <p className="pt-2 text-sm">{formatQty(line.qty_ordered_effective)}</p>
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        Value {formatINR(line.qty_ordered_effective * line.unit_rate)}
        {line.schedules.length > 0
          ? ` · ${line.schedules.map((s) => `${formatQty(s.qty)}${s.due_date ? ` by ${formatDate(s.due_date)}` : ""}`).join(", ")}`
          : ""}
      </p>
      {canWrite ? (
        <Button
          size="sm"
          onClick={() =>
            onEdit(
              () =>
                updatePoLine({
                  id: line.id,
                  customerPoId: poId,
                  qtyOrdered: Number(values.qty),
                  unitRate: Number(values.rate),
                  uom: values.uom,
                }),
              `Line ${line.line_no} saved.`,
            )
          }
        >
          <Save className="size-4" aria-hidden="true" />
          Save line
        </Button>
      ) : null}
    </div>
  );
}
