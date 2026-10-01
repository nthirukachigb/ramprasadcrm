import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { LineGrid } from "@/components/grid/LineGrid.client";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Requirement lines" };

export default async function RequirementLinesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;
  const supabase = await createClient();

  const { data: requirement } = await supabase
    .from("requirement")
    .select("id, internal_ref")
    .eq("id", id)
    .maybeSingle();
  if (!requirement) notFound();

  const { data: lines } = await supabase
    .from("requirement_line")
    .select(
      "id, line_no, customer_part_no, oem_part_no, internal_part_no, description, quantity_required, uom, required_delivery_date, line_notes, product_id",
    )
    .eq("requirement_id", id)
    .order("line_no", { ascending: true });

  const initialLines = (lines ?? []).map((line) => ({
    id: line.id,
    line_no: line.line_no,
    customer_part_no: line.customer_part_no,
    oem_part_no: line.oem_part_no,
    internal_part_no: line.internal_part_no,
    description: line.description,
    quantity_required: Number(line.quantity_required),
    uom: line.uom,
    required_delivery_date: line.required_delivery_date,
    line_notes: line.line_notes,
    product_id: line.product_id,
  }));

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
        title="Lines"
        description="Enter or paste up to 500 line items. Row errors are shown before anything is saved."
        actions={
          <Link
            href={`/requirements/${id}/lines/import`}
            className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            Import Excel/CSV
          </Link>
        }
      />
      <LineGrid requirementId={id} initialLines={initialLines} />
    </div>
  );
}
