import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import {
  CoverageWorkspace,
  type CoverageRow,
  type OverrideRow,
} from "@/components/coverage/CoverageWorkspace.client";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth/get-user";
import { canWriteRequirements } from "@/lib/requirements/write-check";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Quantity coverage" };

export default async function CoveragePage({
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

  const { data: rows } = await supabase
    .from("v_requirement_line_coverage")
    .select(
      "requirement_line_id, requirement_id, line_no, description, customer_part_no, internal_part_no, uom, qty_required, qty_indicated, qty_committed, qty_uncovered, has_approved_override",
    )
    .eq("requirement_id", id)
    .order("line_no", { ascending: true });

  const lineIds = (rows ?? []).map((row) => row.requirement_line_id);
  const { data: overrides } = lineIds.length
    ? await supabase
        .from("coverage_override")
        .select("id, requirement_line_id, gap_qty, status, reason")
        .in("requirement_line_id", lineIds)
        .order("created_at", { ascending: false })
    : { data: [] };

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
        title="Quantity coverage"
        description="Firm committed quantity per line, with availability shown separately. Gaps are red; an approved override is amber."
      />
      <CoverageWorkspace
        requirementId={id}
        canWrite={canWrite}
        rows={(rows ?? []) as unknown as CoverageRow[]}
        overrides={(overrides ?? []) as unknown as OverrideRow[]}
      />
    </div>
  );
}
