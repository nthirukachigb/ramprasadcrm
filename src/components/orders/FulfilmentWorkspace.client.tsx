"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  addReadiness,
  createAcceptance,
  createDelivery,
  createDispatch,
  createExtensionRequest,
  createPdi,
  recordPdiResult,
  requestDispatchOverride,
  transitionExtension,
  updateMilestone,
} from "@/lib/actions/fulfilment";
import { formatDate, formatQty } from "@/lib/format";

export interface FLine {
  id: string;
  line_no: number;
  description: string;
  uom: string;
  qty_ordered: number;
  qty_cleared: number;
  qty_dispatched: number;
  qty_delivered: number;
  qty_accepted: number;
  qty_outstanding: number;
  qty_dispatchable: number;
}
export interface FMilestone {
  id: string;
  name: string;
  status: string;
  expected_date: string | null;
  actual_date: string | null;
}
export interface FPdiLine {
  id: string;
  po_line_id: string;
  qty_offered: number;
  qty_cleared: number;
  qty_rejected: number;
  qty_held: number;
}
export interface FPdi {
  id: string;
  status: string;
  called_date: string;
  lines: FPdiLine[];
}
export interface FRisk {
  schedule_id: string;
  po_line_id: string;
  committed_date: string | null;
  forecast_date: string | null;
  risk_status: string;
  qty_outstanding: number;
}
export interface FExtension {
  id: string;
  status: string;
  requested_date: string;
  reason: string | null;
  po_line_id: string | null;
}

const RISK_LABELS: Record<string, string> = {
  unknown: "Unknown forecast",
  at_risk: "At risk",
  late: "Late",
  on_track: "On track",
};

export function FulfilmentWorkspace({
  po,
  lines,
  milestones,
  readiness,
  pdis,
  dispatches,
  deliveries,
  acceptances,
  risks,
  extensions,
  canWrite,
}: {
  po: { id: string; internal_ref: string | null };
  lines: FLine[];
  milestones: FMilestone[];
  readiness: { id: string; po_line_id: string; ready_qty: number; checked_at: string }[];
  pdis: FPdi[];
  dispatches: { id: string; internal_ref: string | null; dispatch_date: string; mode: string | null; lr_awb: string | null; qty: number }[];
  deliveries: { id: string; internal_ref: string | null; delivery_date: string; status: string; qty: number }[];
  acceptances: { id: string; internal_ref: string | null; acceptance_date: string; status: string; accepted: number; rejected: number }[];
  risks: FRisk[];
  extensions: FExtension[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>, success: string, reset?: () => void) {
    setBusy(true);
    setError(null);
    const result = await fn();
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    toast.success(success);
    reset?.();
    router.refresh();
  }

  const lineLabel = (id: string) => {
    const line = lines.find((l) => l.id === id);
    return line ? `#${line.line_no} ${line.description}` : id.slice(0, 8);
  };

  return (
    <div className="space-y-6">
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      {/* Balances */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Line balances</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {lines.map((line) => (
            <div key={line.id} className="flex flex-wrap items-center gap-3 rounded-md border p-2 text-sm">
              <span className="font-medium">
                #{line.line_no} {line.description}
              </span>
              <span className="text-muted-foreground">
                ordered {formatQty(line.qty_ordered)} · cleared {formatQty(line.qty_cleared)} ·
                dispatched {formatQty(line.qty_dispatched)} · accepted {formatQty(line.qty_accepted)}
              </span>
              <Badge
                className={
                  line.qty_outstanding > 0
                    ? "border-transparent bg-amber-100 text-amber-900"
                    : "border-transparent bg-emerald-100 text-emerald-800"
                }
              >
                Outstanding {formatQty(line.qty_outstanding)} {line.uom}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Milestones */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Milestones</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {milestones.map((m) => (
            <form
              key={m.id}
              className="flex flex-wrap items-end gap-2 rounded-md border p-2 text-sm"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                run(
                  () =>
                    updateMilestone({
                      id: m.id,
                      customerPoId: po.id,
                      status: String(f.get("status")),
                      expectedDate: String(f.get("expected") ?? "") || null,
                      actualDate: String(f.get("actual") ?? "") || null,
                      notes: String(f.get("notes") ?? "") || null,
                    }),
                  `${m.name} updated.`,
                );
              }}
            >
              <span className="min-w-40 font-medium">{m.name}</span>
              <div>
                <Label className="text-xs">Status</Label>
                <select
                  name="status"
                  defaultValue={m.status}
                  disabled={!canWrite}
                  className="border-input bg-background h-9 rounded-md border px-2 text-sm"
                >
                  {["pending", "in_progress", "done", "overdue", "cancelled"].map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-xs">Expected</Label>
                <Input name="expected" type="date" defaultValue={m.expected_date ?? ""} disabled={!canWrite} className="h-9" />
              </div>
              <div>
                <Label className="text-xs">Actual</Label>
                <Input name="actual" type="date" defaultValue={m.actual_date ?? ""} disabled={!canWrite} className="h-9" />
              </div>
              {canWrite ? (
                <Button size="sm" type="submit" disabled={busy}>
                  Save
                </Button>
              ) : null}
            </form>
          ))}
        </CardContent>
      </Card>

      {/* Readiness */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Material readiness</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {readiness.length === 0 ? (
            <p className="text-muted-foreground text-sm">No readiness recorded.</p>
          ) : (
            <ul className="text-sm">
              {readiness.map((r) => (
                <li key={r.id} className="text-muted-foreground">
                  {lineLabel(r.po_line_id)} — ready {formatQty(r.ready_qty)} ({formatDate(r.checked_at)})
                </li>
              ))}
            </ul>
          )}
          {canWrite ? (
            <InlineForm
              fields={[
                { name: "lineId", type: "line" },
                { name: "qty", label: "Ready qty", type: "number" },
              ]}
              lines={lines}
              busy={busy}
              submitLabel="Add readiness"
              onSubmit={(f) =>
                run(
                  () =>
                    addReadiness({
                      customerPoId: po.id,
                      poLineId: String(f.get("lineId")),
                      readyQty: Number(f.get("qty")),
                    }),
                  "Readiness recorded.",
                )
              }
            />
          ) : null}
        </CardContent>
      </Card>

      {/* PDI */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">PDI</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {pdis.map((p) => (
            <div key={p.id} className="space-y-2 rounded-md border p-3 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{p.status}</Badge>
                <span className="text-muted-foreground">called {formatDate(p.called_date)}</span>
              </div>
              <ul className="space-y-2">
                {p.lines.map((pl) => (
                  <li key={pl.id} className="flex flex-wrap items-end gap-2">
                    <span className="min-w-40">{lineLabel(pl.po_line_id)}</span>
                    <span className="text-muted-foreground">
                      offered {formatQty(pl.qty_offered)} · cleared {formatQty(pl.qty_cleared)} ·
                      rejected {formatQty(pl.qty_rejected)} · held {formatQty(pl.qty_held)}
                    </span>
                    {canWrite ? (
                      <form
                        className="flex items-end gap-1"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          run(
                            () =>
                              recordPdiResult({
                                id: pl.id,
                                customerPoId: po.id,
                                qtyCleared: Number(f.get("c")),
                                qtyRejected: Number(f.get("r")),
                                qtyHeld: Number(f.get("h")),
                              }),
                            "PDI result recorded.",
                          );
                        }}
                      >
                        <Input name="c" type="number" placeholder="Cleared" className="h-9 w-24" />
                        <Input name="r" type="number" placeholder="Rejected" className="h-9 w-24" />
                        <Input name="h" type="number" placeholder="Held" className="h-9 w-24" />
                        <Button size="sm" type="submit" disabled={busy}>
                          Record
                        </Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {canWrite ? (
            <InlineForm
              fields={[
                { name: "lineId", type: "line" },
                { name: "qty", label: "Offer qty", type: "number" },
              ]}
              lines={lines}
              busy={busy}
              submitLabel="Call PDI"
              onSubmit={(f) =>
                run(
                  () =>
                    createPdi({
                      customerPoId: po.id,
                      lines: [{ poLineId: String(f.get("lineId")), qtyOffered: Number(f.get("qty")) }],
                    }),
                  "PDI called.",
                )
              }
            />
          ) : null}
        </CardContent>
      </Card>

      {/* Dispatch */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dispatch</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {dispatches.length === 0 ? (
            <p className="text-muted-foreground text-sm">No dispatches.</p>
          ) : (
            <ul className="text-sm">
              {dispatches.map((d) => (
                <li key={d.id} className="text-muted-foreground">
                  {d.internal_ref ?? d.id.slice(0, 8)} · {formatQty(d.qty)} · {formatDate(d.dispatch_date)}
                  {d.lr_awb ? ` · LR ${d.lr_awb}` : ""}
                </li>
              ))}
            </ul>
          )}
          {canWrite ? (
            <>
              <div className="text-muted-foreground text-xs">
                Dispatchable: {lines.map((l) => `#${l.line_no} ${formatQty(l.qty_dispatchable)}`).join(" · ")}
              </div>
              <InlineForm
                fields={[
                  { name: "lineId", type: "line" },
                  { name: "qty", label: "Qty", type: "number" },
                  { name: "lr", label: "LR/AWB" },
                ]}
                lines={lines}
                busy={busy}
                submitLabel="Create dispatch"
                onSubmit={(f) =>
                  run(
                    () =>
                      createDispatch({
                        customerPoId: po.id,
                        lrAwb: String(f.get("lr") ?? "") || undefined,
                        lines: [{ poLineId: String(f.get("lineId")), qty: Number(f.get("qty")) }],
                      }),
                    "Dispatch created.",
                  )
                }
              />
              <InlineForm
                fields={[
                  { name: "lineId", type: "line" },
                  { name: "qty", label: "Override qty", type: "number" },
                  { name: "reason", label: "Reason" },
                ]}
                lines={lines}
                busy={busy}
                submitLabel="Request override"
                onSubmit={(f) =>
                  run(
                    () =>
                      requestDispatchOverride({
                        customerPoId: po.id,
                        poLineId: String(f.get("lineId")),
                        qty: Number(f.get("qty")),
                        reason: String(f.get("reason") ?? ""),
                      }),
                    "Override requested.",
                  )
                }
              />
            </>
          ) : null}
        </CardContent>
      </Card>

      {/* Delivery and acceptance */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Delivery and acceptance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-sm">
            <p className="text-muted-foreground">
              Deliveries: {deliveries.length} · Acceptances: {acceptances.length}
            </p>
            <ul className="text-muted-foreground">
              {acceptances.map((a) => (
                <li key={a.id}>
                  {a.internal_ref ?? a.id.slice(0, 8)} · accepted {formatQty(a.accepted)} · rejected{" "}
                  {formatQty(a.rejected)}
                </li>
              ))}
            </ul>
          </div>
          {canWrite ? (
            <>
              <InlineForm
                fields={[
                  { name: "lineId", type: "line" },
                  { name: "qty", label: "Delivered qty", type: "number" },
                  { name: "grn", label: "GRN" },
                ]}
                lines={lines}
                busy={busy}
                submitLabel="Record delivery"
                onSubmit={(f) =>
                  run(
                    () =>
                      createDelivery({
                        customerPoId: po.id,
                        grnNumber: String(f.get("grn") ?? "") || undefined,
                        lines: [{ poLineId: String(f.get("lineId")), qty: Number(f.get("qty")) }],
                      }),
                    "Delivery recorded.",
                  )
                }
              />
              <InlineForm
                fields={[
                  { name: "lineId", type: "line" },
                  { name: "accepted", label: "Accepted", type: "number" },
                  { name: "rejected", label: "Rejected", type: "number" },
                ]}
                lines={lines}
                busy={busy}
                submitLabel="Record acceptance"
                onSubmit={(f) =>
                  run(
                    () =>
                      createAcceptance({
                        customerPoId: po.id,
                        lines: [
                          {
                            poLineId: String(f.get("lineId")),
                            qtyAccepted: Number(f.get("accepted")) || 0,
                            qtyRejected: Number(f.get("rejected")) || 0,
                          },
                        ],
                      }),
                    "Acceptance recorded.",
                  )
                }
              />
            </>
          ) : null}
        </CardContent>
      </Card>

      {/* Risk and extensions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Delivery risk and extensions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {risks.length === 0 ? (
            <p className="text-muted-foreground text-sm">No scheduled deliveries to assess.</p>
          ) : (
            <ul className="text-sm">
              {risks.map((r) => (
                <li key={r.schedule_id} className="flex items-center gap-2">
                  <Badge
                    className={
                      r.risk_status === "late"
                        ? "border-transparent bg-red-100 text-red-800"
                        : r.risk_status === "at_risk"
                          ? "border-transparent bg-amber-100 text-amber-900"
                          : undefined
                    }
                  >
                    {RISK_LABELS[r.risk_status] ?? r.risk_status}
                  </Badge>
                  {lineLabel(r.po_line_id)} · committed {r.committed_date ? formatDate(r.committed_date) : "—"} ·
                  forecast {r.forecast_date ? formatDate(r.forecast_date) : "unknown"}
                </li>
              ))}
            </ul>
          )}

          {extensions.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {extensions.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{e.status}</Badge>
                  <span>
                    {e.po_line_id ? lineLabel(e.po_line_id) : "PO"} → {formatDate(e.requested_date)}
                  </span>
                  {canWrite ? (
                    <span className="flex gap-1">
                      {e.status === "draft" ? (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => transitionExtension({ id: e.id, customerPoId: po.id, toStatus: "pending_approval" }), "Sent for approval.")}>
                          Request approval
                        </Button>
                      ) : null}
                      {e.status === "pending_approval" ? (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => transitionExtension({ id: e.id, customerPoId: po.id, toStatus: "approved" }), "Marked approved.")}>
                          Mark approved
                        </Button>
                      ) : null}
                      {e.status === "approved" ? (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => transitionExtension({ id: e.id, customerPoId: po.id, toStatus: "sent" }), "Marked sent.")}>
                          Mark sent
                        </Button>
                      ) : null}
                      {e.status === "sent" ? (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => transitionExtension({ id: e.id, customerPoId: po.id, toStatus: "granted" }), "Marked granted.")}>
                          Mark granted
                        </Button>
                      ) : null}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {canWrite ? (
            <InlineForm
              fields={[
                { name: "lineId", type: "line" },
                { name: "date", label: "New date", type: "date" },
                { name: "reason", label: "Reason" },
              ]}
              lines={lines}
              busy={busy}
              submitLabel="Create extension request"
              onSubmit={(f) =>
                run(
                  () =>
                    createExtensionRequest({
                      customerPoId: po.id,
                      poLineId: String(f.get("lineId") || "") || null,
                      requestedDate: String(f.get("date")),
                      reason: String(f.get("reason") ?? ""),
                    }),
                  "Extension request created.",
                )
              }
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function InlineForm({
  fields,
  lines,
  busy,
  submitLabel,
  onSubmit,
}: {
  fields: { name: string; label?: string; type?: string }[];
  lines: FLine[];
  busy: boolean;
  submitLabel: string;
  onSubmit: (form: FormData) => void;
}) {
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-md border border-dashed p-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(new FormData(e.currentTarget));
      }}
    >
      {fields.map((field) => (
        <div key={field.name} className="space-y-1">
          <Label className="text-xs">{field.label ?? field.name}</Label>
          {field.type === "line" ? (
            <select
              name={field.name}
              required
              className="border-input bg-background h-9 rounded-md border px-2 text-sm"
            >
              {lines.map((l) => (
                <option key={l.id} value={l.id}>
                  #{l.line_no} {l.description}
                </option>
              ))}
            </select>
          ) : (
            <Input
              name={field.name}
              type={field.type ?? "text"}
              step={field.type === "number" ? "any" : undefined}
              className="h-9 w-40"
            />
          )}
        </div>
      ))}
      <Button size="sm" type="submit" disabled={busy}>
        <Plus className="size-4" aria-hidden="true" />
        {submitLabel}
      </Button>
    </form>
  );
}
