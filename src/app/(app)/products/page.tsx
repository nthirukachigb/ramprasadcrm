import type { Metadata } from "next";
import Link from "next/link";
import { Boxes } from "lucide-react";

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
import { formatINR } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Products" };

interface ProductRow {
  id: string;
  internal_part_number: string;
  description: string;
  category: string | null;
  uom: string;
  standard_price: number | null;
  is_active: boolean;
}

export default async function ProductsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("product")
    .select(
      "id, internal_part_number, description, category, uom, standard_price, is_active",
    )
    .order("internal_part_number", { ascending: true });

  const rows = (data ?? []) as ProductRow[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description="Products, cross-referenced part numbers, approval evidence and pricing history."
        actions={<RecordDialog formKey="product" />}
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No products yet"
          purpose="Add a product with its internal part number and unit of measure, then link customer and OEM part numbers."
          icon={Boxes}
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Internal part number</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>UoM</TableHead>
                <TableHead>Standard price</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono">
                    <Link
                      href={`/products/${row.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {row.internal_part_number}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.description}
                  </TableCell>
                  <TableCell>{row.category ?? "—"}</TableCell>
                  <TableCell>{row.uom}</TableCell>
                  <TableCell>
                    {row.standard_price != null
                      ? formatINR(row.standard_price)
                      : "—"}
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
