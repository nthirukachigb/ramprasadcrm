import type { Metadata } from "next";
import Link from "next/link";
import { Truck } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth/get-user";
import { formatDate, formatQty } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Fulfilment & PDI" };

interface BalanceRow {
  po_line_id: string;
  customer_po_id: string;
  qty_ordered: number;
  qty_cleared: number;
  qty_dispatched: number;
  qty_delivered: number;
  qty_accepted: number;
  qty_outstanding: number;
}

interface RiskRow {
  po_line_id: string;
  customer_po_id: string;
  po_ref: string;
  committed_date: string | null;
  forecast_date: string | null;
  qty_outstanding: number;
  risk_status: string;
}

interface MilestoneRow {
  id: string;
  customer_po_id: string;
  name: string;
  expected_date: string | null;
  status: string;
}

interface PdiRow {
  id: string;
  customer_po_id: string;
  status: string;
  called_date: string;
}

export default async function FulfilmentPage() {
  await requireUser();
  const supabase = await createClient();
  const [balanceResult, riskResult, milestoneResult, pdiResult] = await Promise.all([
    supabase.from("v_po_line_balance").select("po_line_id, customer_po_id, qty_ordered, qty_cleared, qty_dispatched, qty_delivered, qty_accepted, qty_outstanding").order("customer_po_id"),
    supabase.from("v_delivery_risk").select("po_line_id, customer_po_id, po_ref, committed_date, forecast_date, qty_outstanding, risk_status").order("committed_date"),
    supabase.from("fulfilment_milestone").select("id, customer_po_id, name, expected_date, status").not("status", "in", "(done,cancelled)").order("expected_date").limit(100),
    supabase.from("pdi").select("id, customer_po_id, status, called_date").in("status", ["called", "in_progress", "held", "partially_cleared"]).order("called_date", { ascending: false }).limit(100),
  ]);

  const balances = (balanceResult.data ?? []) as BalanceRow[];
  const risks = (riskResult.data ?? []) as RiskRow[];
  const milestones = (milestoneResult.data ?? []) as MilestoneRow[];
  const pdis = (pdiResult.data ?? []) as PdiRow[];
  const blockedPdis = pdis.filter((pdi) => ["held", "partially_cleared"].includes(pdi.status));
  const overdueMilestones = milestones.filter((milestone) => milestone.status === "overdue");
  const hasError = balanceResult.error || riskResult.error || milestoneResult.error || pdiResult.error;

  return (
    <div className="space-y-6">
      <PageHeader title="Fulfilment & PDI" description="Track readiness, PDI calls and results, dispatch, delivery, acceptance and delivery risk." />
      {hasError ? <p role="alert" className="text-destructive text-sm">Some fulfilment data could not be loaded. Refresh and try again.</p> : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">PO lines tracked</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{balances.length}</p><p className="text-muted-foreground text-xs">Fulfilment balances</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">At risk / late</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{risks.filter((risk) => ["at_risk", "late"].includes(risk.risk_status)).length}</p><p className="text-muted-foreground text-xs">Delivery schedules</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">PDI blocked</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{blockedPdis.length}</p><p className="text-muted-foreground text-xs">Held or partially cleared</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Overdue milestones</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{overdueMilestones.length}</p><p className="text-muted-foreground text-xs">Action required</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Delivery risk</CardTitle></CardHeader>
        <CardContent>
          {risks.length === 0 ? <EmptyState title="No delivery risks recorded" purpose="Schedules with missing forecasts, late dates or at-risk forecasts appear here." icon={Truck} /> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>PO</TableHead><TableHead>Risk</TableHead><TableHead>Committed</TableHead><TableHead>Forecast</TableHead><TableHead>Outstanding</TableHead><TableHead /></TableRow></TableHeader><TableBody>{risks.map((risk) => <TableRow key={`${risk.po_line_id}-${risk.committed_date}`}><TableCell>{risk.po_ref}</TableCell><TableCell><Badge variant={risk.risk_status === "late" ? "destructive" : "secondary"}>{risk.risk_status.replace("_", " ")}</Badge></TableCell><TableCell>{risk.committed_date ? formatDate(risk.committed_date) : "Unknown"}</TableCell><TableCell>{risk.forecast_date ? formatDate(risk.forecast_date) : "Unknown"}</TableCell><TableCell>{formatQty(risk.qty_outstanding)}</TableCell><TableCell><Link href={`/orders/${risk.customer_po_id}/fulfilment`} className="underline-offset-4 hover:underline">Open order</Link></TableCell></TableRow>)}</TableBody></Table></div>}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader><CardTitle className="text-base">PO line balances</CardTitle></CardHeader><CardContent>{balances.length === 0 ? <p className="text-muted-foreground text-sm">No PO lines are available.</p> : <ul className="space-y-2 text-sm">{balances.slice(0, 12).map((balance) => <li key={balance.po_line_id} className="rounded-md border p-3"><div className="flex justify-between gap-2"><span className="font-medium">Order {balance.customer_po_id.slice(0, 8)}</span><Badge variant="outline">Outstanding {formatQty(balance.qty_outstanding)}</Badge></div><p className="text-muted-foreground mt-1">Ordered {formatQty(balance.qty_ordered)} · cleared {formatQty(balance.qty_cleared)} · dispatched {formatQty(balance.qty_dispatched)} · delivered {formatQty(balance.qty_delivered)} · accepted {formatQty(balance.qty_accepted)}</p></li>)}</ul>}</CardContent></Card>
        <Card><CardHeader><CardTitle className="text-base">PDI and milestone queue</CardTitle></CardHeader><CardContent>{pdis.length === 0 && milestones.length === 0 ? <p className="text-muted-foreground text-sm">No open PDI calls or milestones.</p> : <ul className="space-y-2 text-sm">{pdis.slice(0, 6).map((pdi) => <li key={pdi.id} className="flex items-center justify-between rounded-md border p-2"><span>PDI {pdi.customer_po_id.slice(0, 8)} · {formatDate(pdi.called_date)}</span><Badge variant="secondary">{pdi.status}</Badge></li>)}{milestones.slice(0, 6).map((milestone) => <li key={milestone.id} className="flex items-center justify-between rounded-md border p-2"><span>{milestone.name} · {milestone.expected_date ? formatDate(milestone.expected_date) : "No date"}</span><Badge variant={milestone.status === "overdue" ? "destructive" : "outline"}>{milestone.status}</Badge></li>)}</ul>}</CardContent></Card>
      </div>
    </div>
  );
}
