import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import {
  OutcomeForm,
  type OutcomeLine,
  type OutcomeValue,
} from "@/components/quotations/OutcomeForm.client";
import { requireUser } from "@/lib/auth/get-user";
import { canWriteRequirements } from "@/lib/requirements/write-check";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Outcome" };

export default async function OutcomePage({
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
    .select("id, quotation_id, quotation:quotation_id(id, internal_quote_no, requirement_id)")
    .eq("id", versionId)
    .maybeSingle();
  if (!version) notFound();
  const quotation = version.quotation as unknown as {
    id: string;
    internal_quote_no: string;
    requirement_id: string;
  };

  const [linesData, outcomes, lossReasons, competitors] = await Promise.all([
    supabase
      .from("quotation_line")
      .select("requirement_line_id, qty_quoted, uom, requirement_line:requirement_line_id(line_no, description)")
      .eq("quotation_version_id", versionId),
    supabase
      .from("line_outcome")
      .select(
        "requirement_line_id, outcome, qty_won, qty_lost, loss_reason_code, loss_reason_other, competitor_partner_id, winning_price, l_position",
      )
      .eq("quotation_version_id", versionId),
    supabase.from("loss_reason").select("code, label").eq("is_active", true).order("sort_order"),
    supabase.from("partner").select("id, name").order("name", { ascending: true }),
  ]);

  const outcomeByLine = new Map(
    (outcomes.data ?? []).map((row) => [row.requirement_line_id as string, row]),
  );

  const lines: OutcomeLine[] = (linesData.data ?? []).map((row) => {
    const rl = row.requirement_line as unknown as { line_no: number; description: string } | null;
    const existing = outcomeByLine.get(row.requirement_line_id as string);
    return {
      requirementLineId: row.requirement_line_id,
      lineNo: rl?.line_no ?? 0,
      description: rl?.description ?? "",
      qtyQuoted: Number(row.qty_quoted),
      uom: row.uom,
      existing: existing
        ? {
            outcome: existing.outcome as OutcomeValue,
            qtyWon: Number(existing.qty_won),
            qtyLost: Number(existing.qty_lost),
            lossReasonCode: existing.loss_reason_code as string | null,
            lossReasonOther: existing.loss_reason_other as string | null,
            competitorPartnerId: existing.competitor_partner_id as string | null,
            winningPrice: existing.winning_price as number | null,
            lPosition: existing.l_position as string | null,
          }
        : null,
    };
  });

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
        title="Outcome"
        description="Record the win, partial award or loss per line. A loss needs a reason; awarded quantity cannot exceed the quoted quantity."
      />
      <OutcomeForm
        versionId={versionId}
        lines={lines}
        lossReasons={(lossReasons.data ?? []) as { code: string; label: string }[]}
        competitors={(competitors.data ?? []) as { id: string; name: string }[]}
        canWrite={canWrite}
      />
    </div>
  );
}
