import type { Metadata } from "next";
import { BadgeIndianRupee, CircleDollarSign } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireRole } from "@/lib/auth/get-user";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Commission" };

interface AgreementRow {
  id: string;
  partner_id: string;
  commission_percent: number;
  effective_from: string;
  effective_to: string | null;
  pricing_validity_days: number | null;
  is_active: boolean;
  notes: string | null;
  partner: { name: string } | null;
}

interface EligibilityRow {
  eligibility_id: string;
  partner_id: string;
  partner_name: string;
  invoice_id: string;
  base_amount: number;
  commission_percent: number;
  commission_amount: number;
  status: string;
  exception_reason: string | null;
  commission_invoice_number: string | null;
  commission_invoice_status: string | null;
}

export default async function CommissionPage() {
  await requireRole(["owner", "finance", "admin"]);
  const supabase = await createClient();
  const [agreementResult, eligibilityResult] = await Promise.all([
    supabase
      .from("commission_agreement")
      .select("id, partner_id, commission_percent, effective_from, effective_to, pricing_validity_days, is_active, notes, partner:partner_id(name)")
      .order("effective_from", { ascending: false }),
    supabase.from("v_commission_receivable").select("eligibility_id, partner_id, partner_name, invoice_id, base_amount, commission_percent, commission_amount, status, exception_reason, commission_invoice_number, commission_invoice_status").order("status"),
  ]);
  const agreements = (agreementResult.data ?? []) as unknown as AgreementRow[];
  const eligibility = (eligibilityResult.data ?? []) as EligibilityRow[];

  return (
    <div className="space-y-6">
      <PageHeader title="Commission" description="Track approved commission agreements and payment-triggered commission work." />
      {agreementResult.error || eligibilityResult.error ? <p role="alert" className="text-destructive text-sm">Some commission data could not be loaded. Apply the Phase 9 commission migration, then refresh.</p> : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Active agreements</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{agreements.filter((agreement) => agreement.is_active).length}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Partners covered</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{new Set(agreements.map((agreement) => agreement.partner_id)).size}</p></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Eligibility queue</CardTitle></CardHeader><CardContent><p className="text-2xl font-semibold">{eligibility.filter((item) => ["proposed", "exception"].includes(item.status)).length}</p><p className="text-muted-foreground text-xs">Payment-triggered proposals</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Commission agreements</CardTitle></CardHeader>
        <CardContent>{agreements.length === 0 ? <EmptyState title="No commission agreements" purpose="Add an approved agreement on an OEM record before commission can be proposed." icon={BadgeIndianRupee} /> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Partner</TableHead><TableHead>Rate</TableHead><TableHead>Effective</TableHead><TableHead>Validity</TableHead><TableHead>Status</TableHead><TableHead>Notes</TableHead></TableRow></TableHeader><TableBody>{agreements.map((agreement) => <TableRow key={agreement.id}><TableCell className="font-medium">{agreement.partner?.name ?? agreement.partner_id.slice(0, 8)}</TableCell><TableCell>{Number(agreement.commission_percent).toFixed(2)}%</TableCell><TableCell>{formatDate(agreement.effective_from)} – {agreement.effective_to ? formatDate(agreement.effective_to) : "Open"}</TableCell><TableCell>{agreement.pricing_validity_days ? `${agreement.pricing_validity_days} days` : "—"}</TableCell><TableCell><Badge variant={agreement.is_active ? "secondary" : "outline"}>{agreement.is_active ? "Active" : "Inactive"}</Badge></TableCell><TableCell>{agreement.notes ?? "—"}</TableCell></TableRow>)}</TableBody></Table></div>}</CardContent>
      </Card>

      <Card><CardHeader><CardTitle className="text-base flex items-center gap-2"><CircleDollarSign className="size-4" aria-hidden="true" />Eligibility and commission invoices</CardTitle></CardHeader><CardContent>{eligibility.length === 0 ? <p className="text-muted-foreground text-sm">No payment-triggered commission proposals yet.</p> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Partner</TableHead><TableHead>Base amount</TableHead><TableHead>Rate</TableHead><TableHead>Commission</TableHead><TableHead>Status</TableHead><TableHead>Exception</TableHead></TableRow></TableHeader><TableBody>{eligibility.map((item) => <TableRow key={item.eligibility_id}><TableCell className="font-medium">{item.partner_name}</TableCell><TableCell>{Number(item.base_amount).toFixed(2)}</TableCell><TableCell>{Number(item.commission_percent).toFixed(2)}%</TableCell><TableCell>{Number(item.commission_amount).toFixed(2)}</TableCell><TableCell><Badge variant={item.status === "exception" ? "destructive" : "secondary"}>{item.status}</Badge></TableCell><TableCell>{item.exception_reason ?? item.commission_invoice_status ?? "—"}</TableCell></TableRow>)}</TableBody></Table></div>}</CardContent></Card>
    </div>
  );
}
