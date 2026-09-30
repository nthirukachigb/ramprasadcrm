import type { Metadata } from "next";

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

export default async function AdminAuditPage() {
  await requireRoleOrRedirect(["owner", "admin"]);
  const supabase = await createClient();

  const { data: events } = await supabase
    .from("audit_events")
    .select(
      "id, table_name, record_id, action, actor, occurred_at, old_data, new_data, reason",
    )
    .order("occurred_at", { ascending: false })
    .limit(100);

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, email");

  const actorNames = new Map<string, string>();
  for (const profile of (profiles ?? []) as {
    id: string;
    full_name: string | null;
    email: string | null;
  }[]) {
    actorNames.set(profile.id, profile.full_name ?? profile.email ?? profile.id);
  }

  const rows = (events ?? []) as AuditRow[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit log"
        description="The latest 100 changes. The audit log is append-only: entries can never be edited or deleted."
      />
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
                    {row.actor ? (actorNames.get(row.actor) ?? "—") : "—"}
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
