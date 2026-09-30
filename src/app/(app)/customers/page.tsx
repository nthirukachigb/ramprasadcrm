import type { Metadata } from "next";
import Link from "next/link";
import { Building2 } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { RecordDialog } from "@/components/masters/record-dialog";
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
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Customers" };

interface CustomerRow {
  id: string;
  name: string;
  customer_type: string | null;
  is_active: boolean;
}

export default async function CustomersPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("customer")
    .select("id, name, customer_type, is_active")
    .order("name", { ascending: true });

  const rows = (data ?? []) as CustomerRow[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description="Agencies, PSUs and government buyers, with divisions, locations, contacts and registrations."
        actions={<RecordDialog formKey="customer" />}
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No customers yet"
          purpose="Add your first customer organisation, then its divisions, locations and contacts."
          icon={Building2}
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organisation</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link
                      href={`/customers/${row.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {row.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground capitalize">
                    {row.customer_type?.replace(/_/g, " ") ?? "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      status={row.is_active ? "active" : "inactive"}
                      tone={row.is_active ? "success" : "neutral"}
                    />
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
