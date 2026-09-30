import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";

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

export const metadata: Metadata = { title: "OEMs & Partners" };

interface PartnerRow {
  id: string;
  name: string;
  country: string;
  is_active: boolean;
  is_defence_qualified: boolean;
}

export default async function OemsPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("partner")
    .select("id, name, country, is_active, is_defence_qualified")
    .order("name", { ascending: true });

  const partners = (data ?? []) as PartnerRow[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="OEMs & Partners"
        description="OEMs, suppliers, subcontractors and agencies, with locations, contacts, agreements and product links."
        actions={<RecordDialog formKey="partner" />}
      />

      {partners.length === 0 ? (
        <EmptyState
          title="No partners yet"
          purpose="Add an OEM, supplier or subcontractor, then its locations, contacts and product links."
          icon={Users}
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organisation</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Defence-qualified</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {partners.map((partner) => (
                <TableRow key={partner.id}>
                  <TableCell>
                    <Link
                      href={`/oems/${partner.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {partner.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {partner.country}
                  </TableCell>
                  <TableCell>
                    {partner.is_defence_qualified
                      ? "Evidence on file"
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      status={partner.is_active ? "active" : "inactive"}
                      tone={partner.is_active ? "success" : "neutral"}
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
