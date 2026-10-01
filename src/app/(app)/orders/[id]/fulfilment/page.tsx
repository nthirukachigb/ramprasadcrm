import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import {
  FulfilmentWorkspace,
  type FExtension,
  type FLine,
  type FMilestone,
  type FPdi,
  type FRisk,
} from "@/components/orders/FulfilmentWorkspace.client";
import { requireUser } from "@/lib/auth/get-user";
import { canWriteRequirements } from "@/lib/requirements/write-check";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Fulfilment" };

export default async function FulfilmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const canWrite = canWriteRequirements(user.roles);
  const { id } = await params;
  const supabase = await createClient();

  const { data: po } = await supabase
    .from("customer_po")
    .select("id, internal_ref")
    .eq("id", id)
    .maybeSingle();
  if (!po) notFound();

  const [balances, milestones, readiness, pdis, dispatches, deliveries, acceptances, risks, extensions] =
    await Promise.all([
      supabase
        .from("v_po_line_balance")
        .select(
          "po_line_id, qty_cleared, qty_dispatched, qty_delivered, qty_accepted, qty_outstanding, qty_dispatchable, po_line:po_line_id(line_no, description, uom, qty_ordered_effective)",
        )
        .eq("customer_po_id", id),
      supabase
        .from("fulfilment_milestone")
        .select("id, name, status, expected_date, actual_date")
        .eq("customer_po_id", id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("material_readiness")
        .select("id, po_line_id, ready_qty, checked_at")
        .eq("customer_po_id", id)
        .order("checked_at", { ascending: false }),
      supabase
        .from("pdi")
        .select("id, status, called_date, lines:pdi_line(id, po_line_id, qty_offered, qty_cleared, qty_rejected, qty_held)")
        .eq("customer_po_id", id)
        .order("called_date", { ascending: false }),
      supabase
        .from("dispatch")
        .select("id, internal_ref, dispatch_date, mode, lr_awb, lines:dispatch_line(qty)")
        .eq("customer_po_id", id)
        .order("dispatch_date", { ascending: false }),
      supabase
        .from("delivery")
        .select("id, internal_ref, delivery_date, status, lines:delivery_line(qty)")
        .eq("customer_po_id", id)
        .order("delivery_date", { ascending: false }),
      supabase
        .from("acceptance")
        .select("id, internal_ref, acceptance_date, status, lines:acceptance_line(qty_accepted, qty_rejected)")
        .eq("customer_po_id", id)
        .order("acceptance_date", { ascending: false }),
      supabase
        .from("v_delivery_risk")
        .select("schedule_id, po_line_id, committed_date, forecast_date, risk_status, qty_outstanding")
        .eq("customer_po_id", id),
      supabase
        .from("extension_request")
        .select("id, status, requested_date, reason, po_line_id")
        .eq("customer_po_id", id)
        .order("created_at", { ascending: false }),
    ]);

  const lines: FLine[] = (balances.data ?? []).map((row) => {
    const pl = row.po_line as unknown as {
      line_no: number;
      description: string;
      uom: string;
      qty_ordered_effective: number;
    } | null;
    return {
      id: row.po_line_id,
      line_no: pl?.line_no ?? 0,
      description: pl?.description ?? "",
      uom: pl?.uom ?? "",
      qty_ordered: Number(pl?.qty_ordered_effective ?? 0),
      qty_cleared: Number(row.qty_cleared),
      qty_dispatched: Number(row.qty_dispatched),
      qty_delivered: Number(row.qty_delivered),
      qty_accepted: Number(row.qty_accepted),
      qty_outstanding: Number(row.qty_outstanding),
      qty_dispatchable: Number(row.qty_dispatchable),
    };
  });

  return (
    <div className="space-y-6">
      <Link
        href={`/orders/${id}`}
        className="text-muted-foreground inline-flex items-center gap-1 text-sm hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {po.internal_ref ?? "Order"}
      </Link>
      <PageHeader
        title="Fulfilment"
        description="Milestones, readiness, PDI, dispatch, delivery and acceptance — with the outstanding balance always visible."
      />
      <FulfilmentWorkspace
        po={{ id: po.id, internal_ref: po.internal_ref }}
        lines={lines}
        milestones={(milestones.data ?? []) as FMilestone[]}
        readiness={(readiness.data ?? []) as { id: string; po_line_id: string; ready_qty: number; checked_at: string }[]}
        pdis={(pdis.data ?? []) as unknown as FPdi[]}
        dispatches={
          (dispatches.data ?? []).map((d) => ({
            id: d.id,
            internal_ref: d.internal_ref,
            dispatch_date: d.dispatch_date,
            mode: d.mode,
            lr_awb: d.lr_awb,
            qty: ((d.lines ?? []) as { qty: number }[]).reduce((s, l) => s + Number(l.qty), 0),
          })) as never
        }
        deliveries={
          (deliveries.data ?? []).map((d) => ({
            id: d.id,
            internal_ref: d.internal_ref,
            delivery_date: d.delivery_date,
            status: d.status,
            qty: ((d.lines ?? []) as { qty: number }[]).reduce((s, l) => s + Number(l.qty), 0),
          })) as never
        }
        acceptances={
          (acceptances.data ?? []).map((a) => ({
            id: a.id,
            internal_ref: a.internal_ref,
            acceptance_date: a.acceptance_date,
            status: a.status,
            accepted: ((a.lines ?? []) as { qty_accepted: number }[]).reduce((s, l) => s + Number(l.qty_accepted), 0),
            rejected: ((a.lines ?? []) as { qty_rejected: number }[]).reduce((s, l) => s + Number(l.qty_rejected), 0),
          })) as never
        }
        risks={(risks.data ?? []) as FRisk[]}
        extensions={(extensions.data ?? []) as FExtension[]}
        canWrite={canWrite}
      />
    </div>
  );
}
