import type { Metadata } from "next";
import Link from "next/link";

import { AuditDetails } from "@/components/admin/audit-details";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireRoleOrRedirect } from "@/lib/auth/get-user";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Admin · Audit" };

interface AuditRow {
  id: number;
  table_name: string;
  record_id: string | null;
  action: string;
  actor: string | null;
  actor_name: string | null;
  occurred_at: string;
  old_data: unknown;
  new_data: unknown;
  reason: string | null;
}

const ACTION_TONES: Record<string, StatusTone> = {
  INSERT: "success",
  UPDATE: "info",
  DELETE: "danger",
};

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    table?: string;
    record?: string;
    actor?: string;
    from?: string;
    to?: string;
  }>;
}) {
  await requireRoleOrRedirect(["owner", "admin"]);
  const filters = await searchParams;
  const supabase = await createClient();

  let auditQuery = supabase
    .from("v_audit_event")
    .select(
      "id, table_name, record_id, action, actor, actor_name, occurred_at, old_data, new_data, reason",
    )
    .order("occurred_at", { ascending: false })
    .limit(100);

  if (filters.table) auditQuery = auditQuery.ilike("table_name", `%${filters.table}%`);
  if (filters.record) auditQuery = auditQuery.ilike("record_id", `%${filters.record}%`);
  if (filters.actor) auditQuery = auditQuery.eq("actor", filters.actor);
  if (filters.from) auditQuery = auditQuery.gte("occurred_at", `${filters.from}T00:00:00Z`);
  if (filters.to) auditQuery = auditQuery.lt("occurred_at", `${filters.to}T00:00:00Z`);

  const { data: events } = await auditQuery;

  const rows = (events ?? []) as AuditRow[];
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value);
  }
  const exportHref = `/api/exports/audit?${query.toString()}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="The latest 100 changes. The audit log is append-only: entries can never be edited or deleted."
        actions={
          <Link
            href={exportHref}
            className="border-input hover:bg-accent inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium"
          >
            Export CSV
          </Link>
        }
      />
      <form className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-5" method="get">
        <label className="grid gap-1 text-sm font-medium">Table<input name="table" defaultValue={filters.table} className="border-input bg-background h-9 rounded-md border px-2" /></label>
        <label className="grid gap-1 text-sm font-medium">Record ID<input name="record" defaultValue={filters.record} className="border-input bg-background h-9 rounded-md border px-2" /></label>
        <label className="grid gap-1 text-sm font-medium">Actor UUID<input name="actor" defaultValue={filters.actor} className="border-input bg-background h-9 rounded-md border px-2" /></label>
        <label className="grid gap-1 text-sm font-medium">From<input type="date" name="from" defaultValue={filters.from} className="border-input bg-background h-9 rounded-md border px-2" /></label>
        <label className="grid gap-1 text-sm font-medium">To<input type="date" name="to" defaultValue={filters.to} className="border-input bg-background h-9 rounded-md border px-2" /></label>
        <button type="submit" className="bg-primary text-primary-foreground h-9 rounded-md px-3 text-sm font-medium sm:col-span-2 lg:col-span-5 lg:w-fit">Apply filters</button>
      </form>
      {rows.length === 0 ? (
        <EmptyState
          title="No audit events yet"
          purpose="Changes to users, roles and (in later phases) business records will appear here."
        />
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Table</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatDate(row.occurred_at)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.table_name}
                    {row.record_id ? (
                      <span className="text-muted-foreground">
                        {" "}
                        #{row.record_id.slice(0, 8)}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      status={row.action}
                      tone={ACTION_TONES[row.action] ?? "neutral"}
                    />
                  </TableCell>
                  <TableCell>
                    {row.actor_name ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-[16rem] truncate text-sm">
                    {row.reason ?? "—"}
                  </TableCell>
                  <TableCell>
                    <AuditDetails
                      oldData={row.old_data}
                      newData={row.new_data}
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
