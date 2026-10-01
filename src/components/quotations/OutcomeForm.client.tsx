"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveLineOutcomes, type LineOutcomeInput } from "@/lib/actions/outcome";
import { formatQty } from "@/lib/format";

const OUTCOMES = [
  { value: "won", label: "Won" },
  { value: "partially_won", label: "Partially won" },
  { value: "lost", label: "Lost" },
  { value: "not_pursued", label: "Not pursued" },
  { value: "cancelled", label: "Cancelled" },
] as const;

export type OutcomeValue = (typeof OUTCOMES)[number]["value"];

export interface OutcomeLine {
  requirementLineId: string;
  lineNo: number;
  description: string;
  qtyQuoted: number;
  uom: string;
  existing?: {
    outcome: OutcomeValue;
    qtyWon: number;
    qtyLost: number;
    lossReasonCode: string | null;
    lossReasonOther: string | null;
    competitorPartnerId: string | null;
    winningPrice: number | null;
    lPosition: string | null;
  } | null;
}

interface Draft {
  outcome: OutcomeValue;
  qtyWon: string;
  qtyLost: string;
  lossReasonCode: string;
  lossReasonOther: string;
  competitorPartnerId: string;
  winningPrice: string;
  lPosition: string;
}

export function OutcomeForm({
  versionId,
  lines,
  lossReasons,
  competitors,
  canWrite,
}: {
  versionId: string;
  lines: OutcomeLine[];
  lossReasons: { code: string; label: string }[];
  competitors: { id: string; name: string }[];
  canWrite: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      lines.map((line) => [
        line.requirementLineId,
        {
          outcome: line.existing?.outcome ?? "lost",
          qtyWon: String(line.existing?.qtyWon ?? 0),
          qtyLost: String(line.existing?.qtyLost ?? line.qtyQuoted),
          lossReasonCode: line.existing?.lossReasonCode ?? "",
          lossReasonOther: line.existing?.lossReasonOther ?? "",
          competitorPartnerId: line.existing?.competitorPartnerId ?? "",
          winningPrice: line.existing?.winningPrice != null ? String(line.existing.winningPrice) : "",
          lPosition: line.existing?.lPosition ?? "",
        },
      ]),
    ),
  );

  function update(lineId: string, patch: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [lineId]: { ...current[lineId], ...patch } }));
  }

  async function save() {
    setError(null);
    const rows: LineOutcomeInput[] = [];
    for (const line of lines) {
      const d = drafts[line.requirementLineId];
      if (d.outcome === "lost" || d.outcome === "not_pursued") {
        if (!d.lossReasonCode) {
          setError(`Line ${line.lineNo}: a loss reason is required.`);
          return;
        }
        if (d.lossReasonCode === "OTHER" && d.lossReasonOther.trim().length < 3) {
          setError(`Line ${line.lineNo}: "Other" needs a description.`);
          return;
        }
      }
      rows.push({
        quotationVersionId: versionId,
        requirementLineId: line.requirementLineId,
        outcome: d.outcome,
        qtyWon: Number(d.qtyWon) || 0,
        qtyLost: Number(d.qtyLost) || 0,
        lossReasonCode: d.lossReasonCode || null,
        lossReasonOther: d.lossReasonOther || null,
        competitorPartnerId: d.competitorPartnerId || null,
        winningPrice: d.winningPrice === "" ? null : Number(d.winningPrice),
        lPosition: d.lPosition || null,
      });
    }
    setBusy(true);
    const result = await saveLineOutcomes({ versionId, rows });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success("Outcomes saved.");
    router.refresh();
  }

  if (!canWrite) {
    return <p className="text-muted-foreground text-sm">You have read-only access.</p>;
  }

  return (
    <div className="space-y-3">
      {lines.map((line) => {
        const d = drafts[line.requirementLineId];
        const reasonNeeded = d.outcome === "lost" || d.outcome === "not_pursued";
        return (
          <div key={line.requirementLineId} className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">
              #{line.lineNo} {line.description}
              <span className="text-muted-foreground"> · quoted {formatQty(line.qtyQuoted)} {line.uom}</span>
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="space-y-1">
                <Label className="text-xs">Outcome</Label>
                <select
                  value={d.outcome}
                  onChange={(e) => {
                    const outcome = e.target.value as OutcomeValue;
                    update(line.requirementLineId, {
                      outcome,
                      qtyWon: outcome === "won" ? String(line.qtyQuoted) : d.qtyWon,
                      qtyLost: outcome === "won" ? "0" : d.qtyLost,
                    });
                  }}
                  className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                >
                  {OUTCOMES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Qty won</Label>
                <Input type="number" step="any" value={d.qtyWon} onChange={(e) => update(line.requirementLineId, { qtyWon: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Qty lost</Label>
                <Input type="number" step="any" value={d.qtyLost} onChange={(e) => update(line.requirementLineId, { qtyLost: e.target.value })} className="h-9" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">L-position</Label>
                <Input value={d.lPosition} onChange={(e) => update(line.requirementLineId, { lPosition: e.target.value })} className="h-9" placeholder="L1 / L2" />
              </div>
              {reasonNeeded ? (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Loss reason</Label>
                    <select
                      value={d.lossReasonCode}
                      onChange={(e) => update(line.requirementLineId, { lossReasonCode: e.target.value })}
                      className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                    >
                      <option value="">— select —</option>
                      {lossReasons.map((r) => (
                        <option key={r.code} value={r.code}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {d.lossReasonCode === "OTHER" ? (
                    <div className="space-y-1 sm:col-span-2">
                      <Label className="text-xs">Other reason (required)</Label>
                      <Input value={d.lossReasonOther} onChange={(e) => update(line.requirementLineId, { lossReasonOther: e.target.value })} className="h-9" />
                    </div>
                  ) : null}
                </>
              ) : null}
              <div className="space-y-1">
                <Label className="text-xs">Competitor</Label>
                <select
                  value={d.competitorPartnerId}
                  onChange={(e) => update(line.requirementLineId, { competitorPartnerId: e.target.value })}
                  className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
                >
                  <option value="">— none —</option>
                  {competitors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Winning price</Label>
                <Input type="number" step="any" value={d.winningPrice} onChange={(e) => update(line.requirementLineId, { winningPrice: e.target.value })} className="h-9" />
              </div>
            </div>
          </div>
        );
      })}

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <Button onClick={save} disabled={busy || lines.length === 0}>
        Save outcomes
      </Button>
    </div>
  );
}
