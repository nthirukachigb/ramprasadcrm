"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { CoverageBar } from "@/components/status/coverage-bar";
import { QtyStrip } from "@/components/status/qty-strip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { requestCoverageOverride } from "@/lib/actions/coverage";

export interface CoverageRow {
  requirement_line_id: string;
  requirement_id: string;
  line_no: number;
  description: string;
  customer_part_no: string | null;
  internal_part_no: string | null;
  uom: string | null;
  qty_required: number;
  qty_indicated: number;
  qty_committed: number;
  qty_uncovered: number;
  has_approved_override: boolean;
}
export interface OverrideRow {
  id: string;
  requirement_line_id: string;
  gap_qty: number;
  status: string;
  reason: string;
}

export function CoverageWorkspace({
  requirementId,
  canWrite,
  rows,
  overrides,
}: {
  requirementId: string;
  canWrite: boolean;
  rows: CoverageRow[];
  overrides: OverrideRow[];
}) {
  const router = useRouter();
  const [gapsOnly, setGapsOnly] = useState(false);
  const [target, setTarget] = useState<CoverageRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const overrideByLine = useMemo(() => {
    const map = new Map<string, OverrideRow>();
    for (const o of overrides) {
      // keep the most recent status per line (approved/resolved beat requested)
      const existing = map.get(o.requirement_line_id);
      if (!existing || o.status !== "requested") {
        map.set(o.requirement_line_id, o);
      }
    }
    return map;
  }, [overrides]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          required: acc.required + Number(row.qty_required),
          committed: acc.committed + Number(row.qty_committed),
          uncovered: acc.uncovered + Number(row.qty_uncovered),
        }),
        { required: 0, committed: 0, uncovered: 0 },
      ),
    [rows],
  );

  const visible = gapsOnly ? rows.filter((row) => Number(row.qty_uncovered) > 0) : rows;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target) return;
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = await requestCoverageOverride({
      requirementId,
      requirementLineId: target.requirement_line_id,
      gapQty: Number(form.get("gapQty")),
      reason: String(form.get("reason") ?? ""),
      risk: String(form.get("risk") ?? ""),
      mitigation: String(form.get("mitigation") ?? ""),
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success("Override requested; sent to the Owner for approval.");
    setTarget(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <CoverageBar
        totalRequired={totals.required}
        totalCommitted={totals.committed}
        totalUncovered={totals.uncovered}
        gapLines={rows.filter((row) => Number(row.qty_uncovered) > 0).length}
        totalLines={rows.length}
      />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4"
          checked={gapsOnly}
          onChange={(event) => setGapsOnly(event.target.checked)}
        />
        Gaps only
      </label>

      {visible.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {gapsOnly ? "No lines with a coverage gap." : "No lines on this requirement."}
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {visible.map((row) => {
            const override = overrideByLine.get(row.requirement_line_id);
            const uncovered = Number(row.qty_uncovered);
            const canRequest =
              canWrite &&
              uncovered > 0 &&
              !row.has_approved_override &&
              override?.status !== "requested";
            return (
              <li key={row.requirement_line_id} className="space-y-2 p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">
                    #{row.line_no} {row.description}
                  </span>
                  {row.internal_part_no ? (
                    <span className="text-muted-foreground text-xs">
                      {row.internal_part_no}
                    </span>
                  ) : null}
                  {override ? (
                    <Badge
                      className={
                        override.status === "approved" || override.status === "resolved"
                          ? "border-transparent bg-amber-100 text-amber-900"
                          : override.status === "rejected"
                            ? "border-transparent bg-red-100 text-red-800"
                            : "border-transparent bg-sky-100 text-sky-900"
                      }
                    >
                      Override {override.status}
                    </Badge>
                  ) : null}
                  {canRequest ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-auto"
                      onClick={() => {
                        setTarget(row);
                        setError(null);
                      }}
                    >
                      Request override
                    </Button>
                  ) : null}
                </div>
                <QtyStrip
                  required={Number(row.qty_required)}
                  indicated={Number(row.qty_indicated)}
                  committed={Number(row.qty_committed)}
                  uncovered={uncovered}
                  uom={row.uom}
                  hasOverride={row.has_approved_override}
                />
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent>
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Request a coverage override</DialogTitle>
              <DialogDescription>
                The Owner approves accepting the uncovered quantity. It appears on
                the coverage view and in the audit log.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="gapQty">Uncovered quantity</Label>
              <Input
                id="gapQty"
                name="gapQty"
                type="number"
                min="0"
                step="any"
                defaultValue={target ? String(target.qty_uncovered) : ""}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reason">Reason (required)</Label>
              <Textarea id="reason" name="reason" rows={2} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="risk">Risk</Label>
              <Textarea id="risk" name="risk" rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mitigation">Mitigation</Label>
              <Textarea id="mitigation" name="mitigation" rows={2} />
            </div>
            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="submit" disabled={busy}>
                Send for approval
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <p className="text-muted-foreground text-xs">
        Figures are read from <code>v_requirement_line_coverage</code>, the same
        view used by the dashboard and exports. Availability (hatched) never adds
        to coverage.
      </p>
    </div>
  );
}
