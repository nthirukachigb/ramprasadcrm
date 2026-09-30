import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { SourcingWorkspace } from "@/components/sourcing/SourcingWorkspace.client";
import { requireUser } from "@/lib/auth/get-user";
import { canWriteRequirements } from "@/lib/requirements/write-check";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "OEM sourcing" };

export default async function SourcingPage({
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
    .select("id, internal_ref, status, customer:customer_id(name)")
    .eq("id", id)
    .maybeSingle();
  if (!requirement) notFound();

  const { data: linesData } = await supabase
    .from("requirement_line")
    .select("id, line_no, description, quantity_required, uom, customer_part_no, internal_part_no")
    .eq("requirement_id", id)
    .order("line_no", { ascending: true });
  const lines = linesData ?? [];
  const lineIds = lines.map((line) => line.id);

  const [suggestions, shortlist, partners, requests] = await Promise.all([
    supabase.rpc("suggest_partners", { p_requirement_id: id }),
    supabase
      .from("sourcing_shortlist")
      .select("id, requirement_line_id, partner_id, partner:partner_id(name)")
      .eq("requirement_id", id),
    supabase
      .from("partner")
      .select("id, name")
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("sourcing_request")
      .select(
        "id, partner_id, partner:partner_id(name), request_date, response_due_date, channel, status, lines:sourcing_request_line(id, requirement_line_id, qty_requested, requirement_line:requirement_line_id(line_no, description))",
      )
      .eq("requirement_id", id)
      .order("request_date", { ascending: false }),
  ]);

  const requestsData = (requests.data ?? []) as unknown as { id: string }[];
  const requestIds = requestsData.map((request) => request.id);

  const [responses, commitments, selections] = await Promise.all([
    requestIds.length
      ? supabase
          .from("oem_response")
          .select(
            "id, request_id, partner_id, partner:partner_id(name), response_date, partner_quotation_no, status, notes, lines:oem_response_line(id, sourcing_request_line_id, unit_price, lead_time_days, moq, validity_until, indications:quantity_indication(qty_available_indicated), commitments:quantity_commitment(id, qty_committed, status, version, evidence_note))",
          )
          .in("request_id", requestIds)
          .order("response_date", { ascending: false })
      : Promise.resolve({ data: [] }),
    lineIds.length
      ? supabase
          .from("quantity_commitment")
          .select(
            "id, requirement_line_id, requirement_line:requirement_line_id(line_no), partner_id, partner:partner_id(name), qty_committed, version, status, commitment_date, valid_until, evidence_note, evidence_document_id",
          )
          .in("requirement_line_id", lineIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    lineIds.length
      ? supabase
          .from("oem_selection")
          .select(
            "id, requirement_line_id, requirement_line:requirement_line_id(line_no), partner_id, partner:partner_id(name), qty_allocated, status, approval_id",
          )
          .in("requirement_line_id", lineIds)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

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
        title="OEM sourcing"
        description="Suggest and confirm partners, log requests and responses, and keep availability separate from firm commitment."
      />
      <SourcingWorkspace
        requirementId={id}
        canWrite={canWrite}
        lines={lines as never}
        suggestions={(suggestions.data ?? []) as never}
        shortlist={(shortlist.data ?? []) as never}
        partners={(partners.data ?? []) as never}
        requests={requestsData as never}
        responses={(responses.data ?? []) as never}
        commitments={(commitments.data ?? []) as never}
        selections={(selections.data ?? []) as never}
      />
    </div>
  );
}
