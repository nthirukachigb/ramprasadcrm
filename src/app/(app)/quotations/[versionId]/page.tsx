import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import {
  QuotationWorkspace,
  type QuotationHeaderRow,
  type QuotationLineRow,
  type QuotationTotalsRow,
  type TaxRow,
} from "@/components/quotations/QuotationWorkspace.client";
import { requireUser } from "@/lib/auth/get-user";
import { canWriteRequirements } from "@/lib/requirements/write-check";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Quotation" };

export default async function QuotationVersionPage({
  params,
}: {
  params: Promise<{ versionId: string }>;
}) {
  const user = await requireUser();
  const canWrite = canWriteRequirements(user.roles);
  const canApprove = user.roles.includes("owner") || user.roles.includes("admin");
  const { versionId } = await params;
  const supabase = await createClient();

  const { data: version } = await supabase
    .from("quotation_version")
    .select(
      "id, quotation_id, version_no, version_reason, status, currency, fx_rate, valid_until, delivery_terms, payment_terms, technical_compliance_declared, commercial_compliance_declared, quotation:quotation_id(id, internal_quote_no, requirement_id, requirement:requirement_id(internal_ref))",
    )
    .eq("id", versionId)
    .maybeSingle();
  if (!version) notFound();

  const quotation = version.quotation as unknown as {
    id: string;
    internal_quote_no: string;
    requirement_id: string;
    requirement: { internal_ref: string } | null;
  };
  const requirementId = quotation.requirement_id;

  const [linesData, taxes, totals, gates] = await Promise.all([
    supabase
      .from("quotation_line")
      .select(
        "id, requirement_line_id, qty_quoted, uom, unit_cost, freight_unit, other_cost_unit, target_margin_pct, proposed_unit_price, lead_time_days, sourcing_basis, notes, requirement_line:requirement_line_id(line_no, description)",
      )
      .eq("quotation_version_id", versionId),
    supabase
      .from("tax_line")
      .select("id, tax_type, rate_pct, taxable_amount, amount")
      .eq("parent_type", "quotation_version")
      .eq("parent_id", versionId),
    supabase
      .from("v_quotation_totals")
      .select("line_count, net_amount, cost_amount, tax_amount, gross_amount, margin_pct")
      .eq("quotation_version_id", versionId)
      .maybeSingle(),
    supabase.rpc("quotation_gate_errors", { p_version_id: versionId }),
  ]);

  const lines: QuotationLineRow[] = (linesData.data ?? []).map((row) => {
    const rl = row.requirement_line as unknown as {
      line_no: number;
      description: string;
    } | null;
    return {
      id: row.id,
      requirement_line_id: row.requirement_line_id,
      line_no: rl?.line_no ?? 0,
      description: rl?.description ?? "",
      qty_quoted: Number(row.qty_quoted),
      uom: row.uom,
      unit_cost: row.unit_cost,
      freight_unit: row.freight_unit,
      other_cost_unit: row.other_cost_unit,
      target_margin_pct: row.target_margin_pct,
      proposed_unit_price: row.proposed_unit_price,
      lead_time_days: row.lead_time_days,
      sourcing_basis: row.sourcing_basis,
      notes: row.notes,
    };
  });

  return (
    <div className="space-y-6">
      <Link
        href={`/requirements/${requirementId}/quotations`}
        className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {quotation.requirement?.internal_ref ?? "Requirement"}
      </Link>
      <PageHeader
        title={`Quotation ${quotation.internal_quote_no}`}
        description="Build the priced version, declare compliance, then submit for Owner approval."
      />
      <QuotationWorkspace
        version={version as unknown as QuotationHeaderRow}
        quotation={{
          id: quotation.id,
          internal_quote_no: quotation.internal_quote_no,
          requirementId,
          requirement_ref: quotation.requirement?.internal_ref ?? "",
        }}
        lines={lines}
        taxes={(taxes.data ?? []) as TaxRow[]}
        totals={
          (totals.data as unknown as QuotationTotalsRow) ?? {
            line_count: lines.length,
            net_amount: 0,
            cost_amount: 0,
            tax_amount: 0,
            gross_amount: 0,
            margin_pct: null,
          }
        }
        gateErrors={(gates.data ?? []) as string[]}
        canWrite={canWrite}
        canApprove={canApprove}
      />
    </div>
  );
}
