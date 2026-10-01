import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import {
  ResponsePanel,
  type NegotiationRow,
} from "@/components/quotations/ResponsePanel.client";
import { requireUser } from "@/lib/auth/get-user";
import { canWriteRequirements } from "@/lib/requirements/write-check";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Customer response" };

export default async function ResponsePage({
  params,
}: {
  params: Promise<{ versionId: string }>;
}) {
  const user = await requireUser();
  const canWrite = canWriteRequirements(user.roles);
  const { versionId } = await params;
  const supabase = await createClient();

  const { data: version } = await supabase
    .from("quotation_version")
    .select("id, quotation_id, quotation:quotation_id(id, internal_quote_no)")
    .eq("id", versionId)
    .maybeSingle();
  if (!version) notFound();
  const quotation = version.quotation as unknown as { id: string; internal_quote_no: string };

  const [response, approvedVersions] = await Promise.all([
    supabase
      .from("customer_response")
      .select("id, status")
      .eq("quotation_id", quotation.id)
      .maybeSingle(),
    supabase
      .from("quotation_version")
      .select("id, version_no")
      .eq("quotation_id", quotation.id)
      .in("status", ["approved", "submitted"])
      .order("version_no", { ascending: false }),
  ]);

  const events = response.data
    ? await supabase
        .from("negotiation_event")
        .select("id, event_date, event_type, detail, price_change_requested, requested_price, agreed")
        .eq("customer_response_id", response.data.id)
        .order("event_date", { ascending: false })
    : { data: [] };

  return (
    <div className="space-y-6">
      <Link
        href={`/quotations/${versionId}`}
        className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {quotation.internal_quote_no}
      </Link>
      <PageHeader
        title="Customer response"
        description="Track post-submission states and PNC events. A price change is only agreed through a new approved version."
      />
      <ResponsePanel
        quotationId={quotation.id}
        versionId={versionId}
        response={(response.data as { id: string; status: string } | null) ?? null}
        events={(events.data ?? []) as NegotiationRow[]}
        approvedVersions={(approvedVersions.data ?? []) as { id: string; version_no: number }[]}
        canWrite={canWrite}
      />
    </div>
  );
}
