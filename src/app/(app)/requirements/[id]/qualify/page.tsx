import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { QualifyForm } from "@/components/requirements/qualify-form.client";
import { requireUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Qualify requirement" };

export default async function QualifyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const supabase = await createClient();

  const { data: requirement } = await supabase
    .from("requirement")
    .select("id, internal_ref, status, qualification_decision")
    .eq("id", id)
    .maybeSingle();
  if (!requirement) notFound();

  const { data: pending } = await supabase
    .from("approval")
    .select("id")
    .eq("subject_type", "requirement")
    .eq("subject_id", id)
    .eq("decision", "pending")
    .maybeSingle();

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
        title="Qualification"
        description="Record a structured bid or no-bid decision (FR-RFI-04)."
      />
      <QualifyForm
        requirementId={id}
        status={requirement.status}
        passPending={Boolean(pending) || requirement.qualification_decision === "pass_requested"}
      />
    </div>
  );
}
