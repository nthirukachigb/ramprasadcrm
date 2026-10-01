import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import {
  PoWorkspace,
  type PoAmendmentRow,
  type PoLineRow,
  type PoMismatchRow,
  type SupplierPoRow,
} from "@/components/orders/PoWorkspace.client";
import { requireUser } from "@/lib/auth/get-user";
import { canWriteRequirements } from "@/lib/requirements/write-check";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Order" };

export default async function OrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const canWrite = canWriteRequirements(user.roles);
  const { id } = await params;
  const supabase = await createClient();

  const { data: poRaw } = await supabase
    .from("customer_po")
    .select(
      "id, internal_ref, customer_po_number, status, po_date, payment_terms, delivery_terms, pdi_required, notes, customer:customer_id(name), version:quotation_version_id(version_no, quotation:quotation_id(requirement:requirement_id(internal_ref)))",
    )
    .eq("id", id)
    .maybeSingle();
  if (!poRaw) notFound();

  const version = poRaw.version as unknown as {
    version_no: number;
    quotation: { requirement: { internal_ref: string } | null } | null;
  };

  const [linesData, mismatchesData, amendmentsData, suppliers, partners] = await Promise.all([
    supabase
      .from("po_line")
      .select(
        "id, qty_ordered, qty_ordered_effective, unit_rate, uom, quotation_line:quotation_line_id(requirement_line:requirement_line_id(line_no, description)), schedules:po_delivery_schedule(id, sequence, qty, due_date)",
      )
      .eq("customer_po_id", id),
    supabase
      .from("po_mismatch")
      .select("id, po_line_id, field, quoted_value, po_value, severity, resolution, approval_id, approval:approval_id(decision)")
      .eq("customer_po_id", id),
    supabase
      .from("po_amendment")
      .select("id, amendment_no, status, reason, changes:po_amendment_change(field, old_value, new_value)")
      .eq("customer_po_id", id)
      .order("amendment_no"),
    supabase
      .from("supplier_po")
      .select("id, internal_ref, status, partner:partner_id(name)")
      .eq("customer_po_id", id),
    supabase.from("partner").select("id, name").order("name", { ascending: true }),
  ]);

  const lines: PoLineRow[] = (linesData.data ?? []).map((row) => {
    const ql = row.quotation_line as unknown as {
      requirement_line: { line_no: number; description: string } | null;
    } | null;
    return {
      id: row.id,
      line_no: ql?.requirement_line?.line_no ?? 0,
      description: ql?.requirement_line?.description ?? "",
      qty_ordered: Number(row.qty_ordered),
      qty_ordered_effective: Number(row.qty_ordered_effective),
      unit_rate: Number(row.unit_rate),
      uom: row.uom,
      schedules: ((row.schedules ?? []) as { id: string; sequence: number; qty: number; due_date: string | null }[]).sort(
        (a, b) => a.sequence - b.sequence,
      ),
    };
  });

  const mismatches: PoMismatchRow[] = (
    (mismatchesData.data ?? []) as unknown as {
      id: string;
      po_line_id: string | null;
      field: string;
      quoted_value: string | null;
      po_value: string | null;
      severity: string;
      resolution: string;
      approval_id: string | null;
      approval: { decision: string } | null;
    }[]
  ).map((row) => ({
    id: row.id,
    po_line_id: row.po_line_id,
    field: row.field,
    quoted_value: row.quoted_value,
    po_value: row.po_value,
    severity: row.severity,
    resolution: row.resolution,
    approval_id: row.approval_id,
    approval_decision: row.approval?.decision ?? null,
  }));

  const amendments: PoAmendmentRow[] = (
    (amendmentsData.data ?? []) as unknown as {
      id: string;
      amendment_no: number;
      status: string;
      reason: string | null;
      changes: { field: string; old_value: string | null; new_value: string | null }[];
    }[]
  ).map((row) => ({
    id: row.id,
    amendment_no: row.amendment_no,
    status: row.status,
    reason: row.reason,
    changes: row.changes ?? [],
  }));

  const supplierPos: SupplierPoRow[] = (suppliers.data ?? []).map((row) => ({
    id: row.id,
    internal_ref: row.internal_ref,
    partner_name: (row.partner as unknown as { name: string } | null)?.name ?? null,
    status: row.status,
  }));

  return (
    <div className="space-y-6">
      <Link
        href="/orders"
        className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Orders
      </Link>
      <PageHeader
        title={poRaw.internal_ref ?? poRaw.customer_po_number}
        description="Review variances, schedule deliveries, record amendments and raise supplier POs."
        actions={
          <Link
            href={`/orders/${id}/fulfilment`}
            className="border-input bg-background hover:bg-accent inline-flex h-9 items-center rounded-md border px-3 text-sm font-medium"
          >
            Fulfilment
          </Link>
        }
      />
      <PoWorkspace
        po={{
          id: poRaw.id,
          internal_ref: poRaw.internal_ref,
          customer_po_number: poRaw.customer_po_number,
          status: poRaw.status,
          po_date: poRaw.po_date,
          payment_terms: poRaw.payment_terms,
          delivery_terms: poRaw.delivery_terms,
          pdi_required: poRaw.pdi_required,
          notes: poRaw.notes,
          customer_name: (poRaw.customer as unknown as { name: string } | null)?.name ?? "",
          requirement_ref: version?.quotation?.requirement?.internal_ref ?? "",
          version_no: version?.version_no ?? 0,
        }}
        lines={lines}
        mismatches={mismatches}
        amendments={amendments}
        supplierPos={supplierPos}
        partners={(partners.data ?? []) as { id: string; name: string }[]}
        canWrite={canWrite}
      />
    </div>
  );
}
