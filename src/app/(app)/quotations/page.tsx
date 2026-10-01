import type { Metadata } from "next";
import Link from "next/link";
import { FileText } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireUser } from "@/lib/auth/get-user";
import { formatDate } from "@/lib/format";
import { QUOTATION_STATUS_LABELS } from "@/lib/schemas/quotation";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Quotations" };

interface Row {
  id: string;
  internal_quote_no: string;
  current_version_id: string | null;
  requirement: { internal_ref: string } | null;
  current_version: { version_no: number; status: string } | null;
  created_at: string;
}

export default async function QuotationsPage() {
  await requireUser();
  const supabase = await createClient();

  const { data } = await supabase
    .from("quotation")
    .select(
      "id, internal_quote_no, current_version_id, created_at, requirement:requirement_id(internal_ref), current_version:current_version_id(version_no, status)",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quotations"
        description="Every quotation belongs to a requirement. Open one to build, approve or revise it."
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No quotations yet"
          purpose="Open a requirement and choose Quotations to create the first draft."
          icon={FileText}
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quote no.</TableHead>
                <TableHead>Requirement</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    {row.current_version_id ? (
                      <Link
                        href={`/quotations/${row.current_version_id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {row.internal_quote_no}
                      </Link>
                    ) : (
                      <span className="font-medium">{row.internal_quote_no}</span>
                    )}
                  </TableCell>
                  <TableCell>{row.requirement?.internal_ref ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.current_version ? `v${row.current_version.version_no}` : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      {QUOTATION_STATUS_LABELS[row.current_version?.status ?? ""] ??
                        row.current_version?.status ??
                        "—"}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDate(row.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
