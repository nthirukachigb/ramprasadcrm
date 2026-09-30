import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Factory, History, ListChecks, PenLine } from "lucide-react";

import { ChecklistPanel, type ChecklistRow } from "@/components/checklist/ChecklistPanel.client";
import {
  ClarificationsPanel,
  type ClarificationRow,
} from "@/components/clarifications/ClarificationsPanel.client";
import { DocumentsPanel, type DocumentRow } from "@/components/documents/DocumentsPanel.client";
import { PageHeader } from "@/components/page-header";
import { StatusActions } from "@/components/requirements/status-actions.client";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUser } from "@/lib/auth/get-user";
import { formatDate } from "@/lib/format";
import { STATUS_TONES } from "@/lib/requirements/status";
import { canWriteRequirements } from "@/lib/requirements/write-check";
import { STATUS_LABELS } from "@/lib/schemas/requirement";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Requirement" };

interface RequirementRecord {
  id: string;
  internal_ref: string;
  status: string;
  requirement_type: string;
  customer_reference: string;
  customer_id: string;
  enquiry_date: string;
  submission_deadline: string | null;
  deadline_tbc: boolean;
  source_channel: string;
  project_name: string | null;
  estimated_value: number | null;
  notes: string | null;
  qualification_decision: string | null;
  pass_reason: string | null;
  customer: { name: string } | null;
}

export default async function RequirementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const canWrite = canWriteRequirements(user.roles);
  const { id } = await params;
  const supabase = await createClient();

  const { data: requirementData } = await supabase
    .from("requirement")
    .select(
      "id, internal_ref, status, requirement_type, customer_reference, customer_id, enquiry_date, submission_deadline, deadline_tbc, source_channel, project_name, estimated_value, notes, qualification_decision, pass_reason, customer:customer_id(name)",
    )
    .eq("id", id)
    .maybeSingle();

  if (!requirementData) notFound();
  const requirement = requirementData as unknown as RequirementRecord;

  const [lines, checklist, clarifications, docLinks, duplicates, pendingApproval] =
    await Promise.all([
      supabase
        .from("requirement_line")
        .select("id", { count: "exact", head: true })
        .eq("requirement_id", id),
      supabase
        .from("checklist_item")
        .select("id, label, is_mandatory, status, waiver_approval_id")
        .eq("requirement_id", id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("clarification")
        .select(
          "id, clarification_type, subject, detail, status, due_date, response_text",
        )
        .eq("requirement_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("document_link")
        .select(
          "document_id, document:document_id(id, title, document_type, is_active, document_version(file_name, scan_status, size_bytes, created_at))",
        )
        .eq("entity_type", "requirement")
        .eq("entity_id", id),
      supabase.rpc("requirement_duplicate_customer_ref", {
        p_customer_id: requirement.customer_id,
        p_customer_reference: requirement.customer_reference,
        p_exclude_id: id,
      }),
      supabase
        .from("approval")
        .select("id")
        .eq("subject_type", "requirement")
        .eq("subject_id", id)
        .eq("decision", "pending")
        .maybeSingle(),
    ]);

  const documentRows: DocumentRow[] = (docLinks.data ?? []).map((link) => {
    const doc = link.document as unknown as {
      id: string;
      title: string;
      document_type: string | null;
      is_active: boolean;
      document_version: {
        file_name: string;
        scan_status: string;
        size_bytes: number;
        created_at: string;
      }[];
    } | null;
    const versions = [...(doc?.document_version ?? [])].sort((a, b) =>
      a.created_at < b.created_at ? 1 : -1,
    );
    const latest = versions[0];
    return {
      documentId: doc?.id ?? link.document_id,
      title: doc?.title ?? "Untitled",
      documentType: doc?.document_type ?? null,
      fileName: latest?.file_name ?? "—",
      scanStatus: latest?.scan_status ?? "unscanned",
      sizeBytes: latest?.size_bytes ?? null,
      createdAt: latest?.created_at ?? null,
    };
  });

  const duplicateMatches = (duplicates.data ?? []) as {
    id: string;
    internal_ref: string;
  }[];

  return (
    <div className="space-y-6">
      <PageHeader
        title={requirement.internal_ref}
        description={`${requirement.customer?.name ?? "—"} · ${requirement.customer_reference}`}
        actions={
          <Button asChild variant="outline">
            <Link href={`/requirements/${id}/timeline`}>
              <History className="size-4" aria-hidden="true" />
              Timeline
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge
          status={STATUS_LABELS[requirement.status] ?? requirement.status}
          tone={STATUS_TONES[requirement.status] ?? "neutral"}
        />
        {requirement.deadline_tbc ? (
          <span className="text-muted-foreground text-sm">
            Deadline to be confirmed — a follow-up task will be created when
            tasks are enabled.
          </span>
        ) : null}
        <span className="ml-auto" />
        <StatusActions
          requirementId={id}
          status={requirement.status}
          canWrite={canWrite}
        />
      </div>

      {duplicateMatches.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          This customer already has a requirement with the same reference:{" "}
          {duplicateMatches.map((match, index) => (
            <span key={match.id}>
              {index > 0 ? ", " : ""}
              <Link
                href={`/requirements/${match.id}`}
                className="font-medium underline"
              >
                {match.internal_ref}
              </Link>
            </span>
          ))}
        </div>
      ) : null}

      {pendingApproval.data ? (
        <p className="rounded-md border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900">
          A decision for this requirement is waiting for Owner approval in the
          approvals inbox.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Header</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
            <Detail label="Type" value={requirement.requirement_type} />
            <Detail label="Source channel" value={requirement.source_channel} />
            <Detail label="Project" value={requirement.project_name} />
            <Detail
              label="Enquiry date"
              value={formatDate(requirement.enquiry_date)}
            />
            <Detail
              label="Submission deadline"
              value={
                requirement.deadline_tbc
                  ? "TBC"
                  : requirement.submission_deadline
                    ? formatDate(requirement.submission_deadline)
                    : "—"
              }
            />
            <Detail
              label="Estimated value"
              value={
                requirement.estimated_value != null
                  ? `₹ ${requirement.estimated_value}`
                  : "—"
              }
            />
            {requirement.notes ? (
              <div className="sm:col-span-2">
                <p className="text-muted-foreground text-xs">Notes</p>
                <p>{requirement.notes}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button asChild variant="outline" className="justify-start">
              <Link href={`/requirements/${id}/lines`}>
                <ListChecks className="size-4" aria-hidden="true" />
                Lines ({lines.count ?? 0})
                <ExternalLink className="ml-auto size-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link href={`/requirements/${id}/sourcing`}>
                <Factory className="size-4" aria-hidden="true" />
                OEM sourcing
                <ExternalLink className="ml-auto size-4" aria-hidden="true" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="justify-start">
              <Link href={`/requirements/${id}/qualify`}>
                <PenLine className="size-4" aria-hidden="true" />
                Qualify (accept / pass)
                <ExternalLink className="ml-auto size-4" aria-hidden="true" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tender checklist</CardTitle>
        </CardHeader>
        <CardContent>
          <ChecklistPanel
            requirementId={id}
            items={(checklist.data ?? []) as ChecklistRow[]}
            canWrite={canWrite}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Clarifications</CardTitle>
        </CardHeader>
        <CardContent>
          <ClarificationsPanel
            requirementId={id}
            items={(clarifications.data ?? []) as ClarificationRow[]}
            canWrite={canWrite}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Documents</CardTitle>
        </CardHeader>
        <CardContent>
          <DocumentsPanel
            requirementId={id}
            documents={documentRows}
            canWrite={canWrite}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="capitalize">{value?.replace(/_/g, " ") ?? "—"}</p>
    </div>
  );
}
