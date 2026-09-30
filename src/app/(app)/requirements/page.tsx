import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, Plus } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
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
import { getCurrentUser } from "@/lib/auth/get-user";
import { STATUS_TONES } from "@/lib/requirements/status";
import {
  REQUIREMENT_STATUSES,
  STATUS_LABELS,
} from "@/lib/schemas/requirement";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";

export const metadata: Metadata = { title: "Requirements" };

interface Row {
  id: string;
  internal_ref: string;
  status: string;
  requirement_type: string;
  customer_reference: string;
  enquiry_date: string;
  submission_deadline: string | null;
  deadline_tbc: boolean;
  assigned_user_id: string | null;
  customer: { name: string } | null;
}

export default async function RequirementsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    q?: string;
    mine?: string;
    tile?: string;
  }>;
}) {
  const params = await searchParams;
  const user = await getCurrentUser();
  const supabase = await createClient();

  let query = supabase
    .from("requirement")
    .select(
      "id, internal_ref, status, requirement_type, customer_reference, enquiry_date, submission_deadline, deadline_tbc, assigned_user_id, customer:customer_id(name)",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  // Dashboard tile drill-downs use the same predicates as the tile views.
  if (params.tile === "d01") {
    query = query.in("status", ["received", "qualifying"]);
  } else if (params.tile === "d02") {
    query = query.eq("status", "in_preparation");
  } else if (params.tile === "d03") {
    const soon = new Date();
    soon.setDate(soon.getDate() + 7);
    query = query
      .not(
        "status",
        "in",
        "(submitted,won,partially_won,lost,not_pursued,cancelled,closed)",
      )
      .not("submission_deadline", "is", null)
      .gte("submission_deadline", new Date().toISOString())
      .lte("submission_deadline", soon.toISOString());
  }

  if (params.status) query = query.eq("status", params.status);
  if (params.q) {
    query = query.or(
      `internal_ref.ilike.%${params.q}%,customer_reference.ilike.%${params.q}%`,
    );
  }
  if (params.mine === "1" && user) {
    query = query.eq("assigned_user_id", user.id);
  }

  const { data } = await query;
  const rows = (data ?? []) as unknown as Row[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Requirements"
        description="RFIs, RFQs, enquiries and tenders — one connected record with up to 500 line items."
        actions={
          <Button asChild>
            <Link href="/requirements/new">
              <Plus className="size-4" aria-hidden="true" />
              New requirement
            </Link>
          </Button>
        }
      />

      <form className="flex flex-wrap items-end gap-3" method="get">
        <div className="space-y-1.5">
          <label htmlFor="q" className="text-sm font-medium">
            Search
          </label>
          <Input
            id="q"
            name="q"
            placeholder="Reference or customer ref"
            defaultValue={params.q ?? ""}
            className="w-64"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="status" className="text-sm font-medium">
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={params.status ?? ""}
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
          >
            <option value="">All statuses</option>
            {REQUIREMENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status] ?? status}
              </option>
            ))}
          </select>
        </div>
        <label className="flex h-9 items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="mine"
            value="1"
            defaultChecked={params.mine === "1"}
            className="size-4 rounded border"
          />
          Assigned to me
        </label>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          title="No requirements found"
          purpose="Capture a new RFI, RFQ, enquiry or tender to start the record."
          icon={ClipboardList}
          action={
            <Button asChild>
              <Link href="/requirements/new">New requirement</Link>
            </Button>
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
                <TableHead>Deadline</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link
                      href={`/requirements/${row.id}`}
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
                      status={STATUS_LABELS[row.status] ?? row.status}
                      tone={STATUS_TONES[row.status] ?? "neutral"}
                    />
                  </TableCell>
                  <TableCell>{formatDate(row.enquiry_date)}</TableCell>
                  <TableCell>
                    {row.deadline_tbc
                      ? "TBC"
                      : row.submission_deadline
                        ? formatDate(row.submission_deadline)
                        : "—"}
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
