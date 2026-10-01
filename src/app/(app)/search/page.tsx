import type { Metadata } from "next";
import Link from "next/link";
import { Search, SearchX } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Search" };

interface SearchRow {
  entity_type: string;
  entity_id: string;
  title: string;
  ref_codes: string[];
  status: string | null;
  event_date: string | null;
  match_kind: string;
  rank: number;
  customer_id: string | null;
  partner_id: string | null;
}

const LABELS: Record<string, string> = {
  requirement: "Requirements",
  requirement_line: "Requirement lines",
  quotation: "Quotations",
  customer_po: "Customer POs",
  invoice: "Invoices",
  customer: "Customers",
  customer_division: "Divisions",
  partner: "Partners / OEMs",
  product: "Products",
  document: "Documents",
};

function hrefFor(row: SearchRow): string {
  switch (row.entity_type) {
    case "requirement": return `/requirements/${row.entity_id}`;
    case "requirement_line": return `/search/history?line=${row.entity_id}`;
    case "quotation": return `/quotations?query=${encodeURIComponent(row.title)}`;
    case "customer_po": return `/orders/${row.entity_id}`;
    case "invoice": return `/invoices?query=${encodeURIComponent(row.title)}`;
    case "customer": return `/customers/${row.entity_id}`;
    case "partner": return `/oems/${row.entity_id}`;
    case "product": return `/products/${row.entity_id}`;
    default: return "/search";
  }
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; entity_type?: string; status?: string }>;
}) {
  await requireUser();
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const supabase = await createClient();
  let rows: SearchRow[] = [];
  let suggestions: { title: string; entity_type: string; entity_id: string }[] = [];
  let failed: string | null = null;

  if (q) {
    const { data, error } = await supabase.rpc("search", {
      p_q: q,
      p_filters: { entity_type: params.entity_type ?? "", status: params.status ?? "" },
      p_limit: 100,
      p_cursor: null,
    });
    if (error) failed = "Search is temporarily unavailable. Please try again.";
    rows = (data ?? []) as SearchRow[];
    if (!rows.length) {
      const { data: suggestionRows } = await supabase.rpc("search_suggestions", {
        p_q: q,
        p_limit: 5,
      });
      suggestions = (suggestionRows ?? []) as typeof suggestions;
    }
  }

  const grouped = rows.reduce<Record<string, SearchRow[]>>((groups, row) => {
    (groups[row.entity_type] ??= []).push(row);
    return groups;
  }, {});

  return (
    <div className="space-y-6">
      <PageHeader
        title="Search"
        description="Search requirements, parts, products, customers, OEMs, quotations, POs, invoices and documents under your access." 
        actions={<Button asChild variant="outline"><Link href="/search/history">Comparable history</Link></Button>}
      />
      <form className="flex flex-wrap items-end gap-3" method="get">
        <div className="min-w-64 flex-1 space-y-1.5">
          <label htmlFor="q" className="text-sm font-medium">Search records</label>
          <Input id="q" name="q" defaultValue={q} placeholder="Try DX1001, RQ/26-27/0001 or customer name" autoFocus />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="entity_type" className="text-sm font-medium">Record type</label>
          <select id="entity_type" name="entity_type" defaultValue={params.entity_type ?? ""} className="border-input bg-background h-9 rounded-md border px-3 text-sm">
            <option value="">All record types</option>
            {Object.entries(LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="status" className="text-sm font-medium">Status</label>
          <Input id="status" name="status" defaultValue={params.status ?? ""} placeholder="Any status" className="w-36" />
        </div>
        <Button type="submit"><Search className="size-4" aria-hidden="true" />Search</Button>
      </form>

      {!q ? <EmptyState title="Search across the lifecycle" purpose="Enter a reference, customer, OEM, product, part number or document title." icon={Search} /> : failed ? (
        <div role="alert" className="border-destructive/40 bg-destructive/10 text-destructive rounded-lg border p-4 text-sm">{failed}</div>
      ) : rows.length === 0 ? (
        <div className="space-y-4">
          <EmptyState title="No matching records" purpose="Try fewer words or a part number without spaces or hyphens." icon={SearchX} />
          {suggestions.length ? <div className="rounded-lg border p-4"><p className="text-sm font-medium">Did you mean…</p><div className="mt-2 flex flex-wrap gap-2">{suggestions.map((item) => <Link key={item.entity_id} href={`/search?q=${encodeURIComponent(item.title)}`} className="underline underline-offset-4">{item.title}</Link>)}</div></div> : null}
        </div>
      ) : (
        <div className="space-y-6">
          <p className="text-muted-foreground text-sm">{rows.length} result{rows.length === 1 ? "" : "s"} · ranked by exact, normalized and recent matches</p>
          {Object.entries(grouped).map(([type, typeRows]) => (
            <section key={type} className="space-y-2">
              <h2 className="text-lg font-semibold">{LABELS[type] ?? type}</h2>
              <div className="rounded-lg border">
                <Table><TableHeader><TableRow><TableHead>Record</TableHead><TableHead>References</TableHead><TableHead>Match</TableHead><TableHead>Status</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader><TableBody>
                  {typeRows.map((row) => <TableRow key={`${row.entity_type}-${row.entity_id}`}><TableCell><Link href={hrefFor(row)} className="font-medium underline-offset-4 hover:underline">{row.title}</Link></TableCell><TableCell className="text-muted-foreground">{row.ref_codes?.filter(Boolean).join(", ") || "—"}</TableCell><TableCell><Badge variant="secondary">{row.match_kind}</Badge></TableCell><TableCell>{row.status ?? "—"}</TableCell><TableCell>{row.event_date ? formatDate(row.event_date) : "—"}</TableCell></TableRow>)}
                </TableBody></Table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
