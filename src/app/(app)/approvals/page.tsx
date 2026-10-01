import type { Metadata } from "next";
import Link from "next/link";
import { Inbox } from "lucide-react";

import { ApprovalActions } from "@/components/approvals/approval-actions.client";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth/get-user";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Approvals" };

interface ApprovalRow {
  id: string;
  subject_type: string;
  subject_id: string;
  reason: string | null;
  requested_by: string;
  requested_at: string;
}

export default async function ApprovalsPage() {
  const user = await requireUser();
  const canDecide = user.roles.includes("owner") || user.roles.includes("admin");
  const supabase = await createClient();

  const { data } = await supabase
    .from("approval")
    .select("id, subject_type, subject_id, reason, requested_by, requested_at")
    .eq("decision", "pending")
    .order("requested_at", { ascending: true });

  const rows = (data ?? []) as ApprovalRow[];

  const requirementIds = rows
    .filter((row) => row.subject_type === "requirement")
    .map((row) => row.subject_id);
  const { data: requirements } = requirementIds.length
    ? await supabase
        .from("requirement")
        .select("id, internal_ref")
        .in("id", requirementIds)
    : { data: [] };
  const referenceById = new Map(
    (requirements ?? []).map((row) => [row.id as string, row.internal_ref as string]),
  );

  const selectionIds = rows
    .filter((row) => row.subject_type === "oem_selection")
    .map((row) => row.subject_id);
  const { data: selections } = selectionIds.length
    ? await supabase
        .from("oem_selection")
        .select("id, requirement_line:requirement_line_id(requirement_id)")
    : { data: [] };
  const selectionRequirementById = new Map(
    (selections ?? []).map((row) => [
      row.id as string,
      (row.requirement_line as unknown as { requirement_id: string } | null)
        ?.requirement_id as string,
    ]),
  );

  const overrideIds = rows
    .filter((row) => row.subject_type === "coverage_override")
    .map((row) => row.subject_id);
  const { data: overrides } = overrideIds.length
    ? await supabase
        .from("coverage_override")
        .select("id, requirement_line:requirement_line_id(requirement_id)")
    : { data: [] };
  const overrideRequirementById = new Map(
    (overrides ?? []).map((row) => [
      row.id as string,
      (row.requirement_line as unknown as { requirement_id: string } | null)
        ?.requirement_id as string,
    ]),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals"
        description="Human decisions that gate a transition. Only the Owner (or Admin) can decide."
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No approvals waiting"
          purpose="Requests that need an Owner decision appear here, such as passing a requirement or waiving a checklist item."
          icon={Inbox}
        />
      ) : (
        <ul className="divide-y rounded-lg border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
              <div className="min-w-48">
                <p className="font-medium capitalize">
                  {row.subject_type.replace(/_/g, " ")}
                </p>
                {row.subject_type === "requirement" ? (
                  <Link
                    href={`/requirements/${row.subject_id}`}
                    className="text-primary text-xs underline-offset-4 hover:underline"
                  >
                    {referenceById.get(row.subject_id) ?? row.subject_id}
                  </Link>
                ) : row.subject_type === "oem_selection" &&
                  selectionRequirementById.get(row.subject_id) ? (
                  <Link
                    href={`/requirements/${selectionRequirementById.get(row.subject_id)}/sourcing`}
                    className="text-primary text-xs underline-offset-4 hover:underline"
                  >
                    Open sourcing
                  </Link>
                ) : row.subject_type === "coverage_override" &&
                  overrideRequirementById.get(row.subject_id) ? (
                  <Link
                    href={`/requirements/${overrideRequirementById.get(row.subject_id)}/coverage`}
                    className="text-primary text-xs underline-offset-4 hover:underline"
                  >
                    Open coverage
                  </Link>
                ) : (
                  <p className="text-muted-foreground text-xs">{row.subject_id}</p>
                )}
              </div>
              <p className="text-muted-foreground max-w-md flex-1">{row.reason ?? "—"}</p>
              <span className="text-muted-foreground text-xs">
                {formatDate(row.requested_at)}
              </span>
              {canDecide ? (
                <ApprovalActions approvalId={row.id} canDecide />
              ) : (
                <span className="text-muted-foreground text-xs">Awaiting Owner</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
