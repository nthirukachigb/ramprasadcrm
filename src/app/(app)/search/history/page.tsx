import type { Metadata } from "next";
import Link from "next/link";
import { History } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireRole } from "@/lib/auth/get-user";
import { getComparableHistory, type ComparableRow } from "@/lib/actions/quotation";
import { formatDate, formatINR } from "@/lib/format";

export const metadata: Metadata = { title: "Comparable history" };

const BASIS_LABELS: Record<string, string> = {
  exact: "Exact match",
  cross_reference: "Cross-reference",
  possible: "Possible match",
};

export default async function ComparableHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ line?: string }>;
}) {
  await requireRole(["owner", "sales", "admin"]);
  const params = await searchParams;
  const result = params.line ? await getComparableHistory(params.line) : null;
  const rows: ComparableRow[] = result?.ok ? result.rows : [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Comparable bid history"
        description="Compare prior prices and outcomes before committing a new quote. Margin is visible only to permitted roles."
        actions={<Button asChild variant="outline"><Link href="/search">Global search</Link></Button>}
      />
      {!params.line ? (
        <EmptyState title="Choose a requirement line" purpose="Open a comparable-history link from a quote line or search result." icon={History} />
      ) : !result?.ok ? (
        <div role="alert" className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm">{result?.error ?? "Unable to load comparable history."}</div>
      ) : rows.length === 0 ? (
        <EmptyState title="No comparable history" purpose="No prior quote matches this part, product or description." icon={History} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader><TableRow><TableHead>Match</TableHead><TableHead>Requirement</TableHead><TableHead>OEM</TableHead><TableHead>Quoted</TableHead><TableHead>OEM cost</TableHead><TableHead>PO rate</TableHead><TableHead>Margin</TableHead><TableHead>Outcome</TableHead><TableHead>Evidence</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.quotation_line_id}>
                  <TableCell><Badge variant="secondary">{BASIS_LABELS[row.match_basis] ?? row.match_basis}</Badge></TableCell>
                  <TableCell><div className="flex flex-col"><Link href={`/requirements/${row.requirement_id}`} className="font-medium underline-offset-4 hover:underline">{row.requirement_ref ?? row.requirement_id.slice(0, 8)}</Link>{row.quotation_version_id ? <Link href={`/quotations/${row.quotation_version_id}`} className="text-muted-foreground text-xs underline-offset-4 hover:underline">Quote v{row.version_no}</Link> : null}</div></TableCell>
                  <TableCell>{row.oem_name ?? "—"}</TableCell>
                  <TableCell>{row.proposed_unit_price == null ? "—" : formatINR(row.proposed_unit_price)}</TableCell>
                  <TableCell>{row.oem_cost_unit == null ? "—" : formatINR(row.oem_cost_unit)}</TableCell>
                  <TableCell>{row.po_unit_rate == null ? "—" : formatINR(row.po_unit_rate)}</TableCell>
                  <TableCell>{row.margin_pct == null ? "—" : `${Number(row.margin_pct).toFixed(2)}%`}</TableCell>
                  <TableCell>{row.line_outcome ?? "Awaiting outcome"}{row.loss_reason ? <div className="text-muted-foreground text-xs">{row.loss_reason}</div> : null}</TableCell>
                  <TableCell><div className="flex flex-wrap gap-1">{row.is_migrated ? <Badge variant="outline">Migrated</Badge> : null}{row.is_validated === false ? <Badge variant="outline">Unvalidated</Badge> : null}{row.pdi_rejected_qty ? <Badge variant="outline">PDI rejected {row.pdi_rejected_qty}</Badge> : null}</div></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-muted-foreground border-t p-3 text-xs">Prices are linked to their source quotation; PO rates and outcomes are shown when recorded. Viewed history is logged.</p>
        </div>
      )}
      {result?.ok ? <p className="text-muted-foreground text-xs">As of {formatDate(new Date())}</p> : null}
    </div>
  );
}
