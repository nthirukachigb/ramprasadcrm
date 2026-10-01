"use client";

import { useState } from "react";
import { History } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  getComparableHistory,
  type ComparableRow,
} from "@/lib/actions/quotation";
import { formatINR } from "@/lib/format";

const BASIS_LABELS: Record<string, string> = {
  exact: "Exact match",
  cross_reference: "Cross-reference",
  possible: "Possible match",
};

export function ComparableHistory({ lineId }: { lineId: string }) {
  const [rows, setRows] = useState<ComparableRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(open: boolean) {
    if (!open || rows !== null) return;
    setLoading(true);
    const result = await getComparableHistory(lineId);
    setLoading(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRows(result.rows);
  }

  return (
    <Dialog onOpenChange={load}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          <History className="size-4" aria-hidden="true" />
          History
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Comparable bid history</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : error ? (
          <p className="text-destructive text-sm">{error}</p>
        ) : rows && rows.length > 0 ? (
          <ul className="divide-y rounded-lg border text-sm">
            {rows.map((row) => (
              <li key={row.quotation_line_id} className="flex flex-wrap items-center gap-2 p-2">
                <Badge variant="secondary">{BASIS_LABELS[row.match_basis] ?? row.match_basis}</Badge>
                <span>{row.requirement_ref ?? row.requirement_id.slice(0, 8)}</span>
                <span className="text-muted-foreground">v{row.version_no}</span>
                <span className="ml-auto">
                  {row.proposed_unit_price != null
                    ? formatINR(row.proposed_unit_price)
                    : "—"}
                </span>
                {row.line_outcome ? (
                  <Badge className="border-transparent bg-muted text-muted-foreground">
                    {row.line_outcome}
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">No comparable history.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
