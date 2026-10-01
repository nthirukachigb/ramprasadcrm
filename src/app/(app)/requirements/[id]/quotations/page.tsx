import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { CreateQuotation } from "@/components/quotations/CreateQuotation.client";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth/get-user";
import { canWriteRequirements } from "@/lib/requirements/write-check";
import {
  QUOTATION_STATUS_LABELS,
  VERSION_REASON_LABELS,
} from "@/lib/schemas/quotation";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Quotations" };

export default async function RequirementQuotationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const canWrite = canWriteRequirements(user.roles);
  const { id } = await params;
  const supabase = await createClient();

  const { data: requirement } = await supabase
    .from("requirement")
    .select("id, internal_ref")
    .eq("id", id)
    .maybeSingle();
  if (!requirement) notFound();

  const [linesData, quotations] = await Promise.all([
    supabase
      .from("requirement_line")
      .select("id, line_no, description, quantity_required, uom")
      .eq("requirement_id", id)
      .order("line_no", { ascending: true }),
    supabase
      .from("quotation")
      .select(
        "id, internal_quote_no, current_version_id, versions:quotation_version(id, version_no, version_reason, status)",
      )
      .eq("requirement_id", id)
      .order("created_at", { ascending: false }),
  ]);

  const versions = (quotations.data ?? []).flatMap((quotation) =>
    ((quotation.versions ?? []) as unknown as {
      id: string;
      version_no: number;
      version_reason: string;
      status: string;
    }[]).map((version) => ({
      ...version,
      quoteNo: quotation.internal_quote_no as string,
      isCurrent: quotation.current_version_id === version.id,
    })),
  );

  return (
    <div className="space-y-6">
      <Link
        href={`/requirements/${id}`}
        className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {requirement.internal_ref}
      </Link>
      <PageHeader
        title="Quotations"
        description="Versions are immutable once approved; revisions never overwrite an earlier price."
        actions={
          canWrite ? (
            <CreateQuotation requirementId={id} lines={linesData.data ?? []} />
          ) : undefined
        }
      />

      {versions.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No quotations yet. Create one to start pricing.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {versions.map((version) => (
            <li key={version.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
              <Link
                href={`/quotations/${version.id}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {version.quoteNo}
              </Link>
              <Badge variant="secondary">v{version.version_no}</Badge>
              <span className="text-muted-foreground">
                {VERSION_REASON_LABELS[version.version_reason] ?? version.version_reason}
              </span>
              {version.isCurrent ? (
                <Badge className="border-transparent bg-sky-100 text-sky-900">Current</Badge>
              ) : null}
              <Badge
                className={
                  version.status === "approved" || version.status === "submitted"
                    ? "border-transparent bg-emerald-100 text-emerald-800"
                    : version.status === "pending_approval"
                      ? "border-transparent bg-amber-100 text-amber-900"
                      : undefined
                }
              >
                {QUOTATION_STATUS_LABELS[version.status] ?? version.status}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
