import type { Metadata } from "next";
import Link from "next/link";
import { Send } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireUser } from "@/lib/auth/get-user";
import { STATUS_TONES } from "@/lib/requirements/status";
import { labelFor, STATUS_LABELS } from "@/lib/schemas/requirement";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "OEM Sourcing" };

interface Row {
  id: string;
  internal_ref: string;
  status: string;
  customer_reference: string;
  enquiry_date: string;
  customer: { name: string } | null;
}

export default async function OemSourcingPage() {
  await requireUser();
  const supabase = await createClient();

  const { data } = await supabase
    .from("requirement")
    .select(
      "id, internal_ref, status, customer_reference, enquiry_date, customer:customer_id(name)",
    )
    .in("status", ["qualifying", "in_preparation", "quoted", "submitted"])
    .order("updated_at", { ascending: false })
    .limit(200);

  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="OEM Sourcing"
        description="Open a requirement to shortlist partners, log requests and responses, and record firm commitments."
      />

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing to source yet"
          purpose="Sourcing starts once a requirement is qualifying, in preparation, quoted or submitted. Open a requirement and choose OEM sourcing."
          icon={Send}
          action={
            <Link
              href="/requirements"
              className="text-primary text-sm underline-offset-4 hover:underline"
            >
              Go to requirements
            </Link>
          }
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Customer ref</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Enquiry</TableHead>
                <TableHead>Sourcing</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link
                      href={`/requirements/${row.id}/sourcing`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {row.internal_ref}
                    </Link>
                  </TableCell>
                  <TableCell>{row.customer?.name ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.customer_reference}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      status={labelFor(STATUS_LABELS, row.status)}
                      tone={STATUS_TONES[row.status] ?? "neutral"}
                    />
                  </TableCell>
                  <TableCell>{formatDate(row.enquiry_date)}</TableCell>
                  <TableCell>
                    <Link
                      href={`/requirements/${row.id}/sourcing`}
                      className="text-primary text-sm underline-offset-4 hover:underline"
                    >
                      Open
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
