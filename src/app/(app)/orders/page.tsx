import type { Metadata } from "next";
import Link from "next/link";
import { PackageCheck } from "lucide-react";

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
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Orders" };

const STATUS_LABELS: Record<string, string> = {
  received: "Received",
  under_review: "Under review",
  acknowledged: "Acknowledged",
  amended: "Amended",
  completed: "Completed",
  cancelled: "Cancelled",
};

interface Row {
  id: string;
  internal_ref: string | null;
  customer_po_number: string;
  status: string;
  po_date: string | null;
  customer: { name: string } | null;
  lines: { qty_ordered_effective: number; unit_rate: number }[];
}

export default async function OrdersPage() {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("customer_po")
    .select(
      "id, internal_ref, customer_po_number, status, po_date, customer:customer_id(name), lines:po_line(qty_ordered_effective, unit_rate)",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        description="Customer POs captured from an approved quotation, with variance checking before acknowledgement."
      />
      {rows.length === 0 ? (
        <EmptyState
          title="No orders yet"
          purpose="Open an approved quotation and create a customer PO from it."
          icon={PackageCheck}
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO no.</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Customer PO</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Value</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const value = (row.lines ?? []).reduce(
                  (sum, line) => sum + Number(line.qty_ordered_effective) * Number(line.unit_rate),
                  0,
                );
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link
                        href={`/orders/${row.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {row.internal_ref ?? row.customer_po_number}
                      </Link>
                    </TableCell>
                    <TableCell>{row.customer?.name ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{row.customer_po_number}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{STATUS_LABELS[row.status] ?? row.status}</Badge>
                    </TableCell>
                    <TableCell>{row.po_date ? formatDate(row.po_date) : "—"}</TableCell>
                    <TableCell className="text-right">
                      {new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(value)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
