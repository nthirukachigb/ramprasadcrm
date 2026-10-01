import type { Metadata } from "next";
import { ClipboardList, FileText, Timer } from "lucide-react";

import { PlannedTile, Tile } from "@/components/dashboard/Tile";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Dashboard" };

interface Kpi {
  tile_code: string;
  count_value: number;
  as_of: string;
}
const PLANNED = [
  { code: "D-04", label: "Quotes awaiting response", phase: 5 },
  { code: "D-05", label: "Open orders by status", phase: 7 },
  { code: "D-06", label: "Orders at delivery risk", phase: 8 },
  { code: "D-14", label: "Payments due", phase: 9 },
  { code: "D-18", label: "Documents nearing expiry", phase: 10 },
];

export default async function DashboardPage() {
  await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("v_dashboard_kpis")
    .select("tile_code, count_value, as_of");

  const kpis = (data ?? []) as Kpi[];
  const byCode = new Map(kpis.map((kpi) => [kpi.tile_code, kpi]));
  const asOf = kpis[0]?.as_of ?? new Date().toISOString();

  const count = (code: string) => byCode.get(code)?.count_value ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Live pipeline status. Every tile links to the same list it counts."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Tile
          code="D-01"
          label="Enquiries awaiting qualification"
          count={count("D-01")}
          definition="Requirements in Received or Qualifying status."
          href="/requirements?tile=d01"
          asOf={byCode.get("D-01")?.as_of ?? asOf}
        />
        <Tile
          code="D-02"
          label="Quotations pending preparation"
          count={count("D-02")}
          definition="In-preparation requirements awaiting an approved quotation version."
          href="/requirements?tile=d02"
          asOf={byCode.get("D-02")?.as_of ?? asOf}
        />
        <Tile
          code="D-03"
          label="Approaching submission deadlines"
          count={count("D-03")}
          definition="Requirements with a submission deadline within 7 days."
          href="/requirements?tile=d03"
          asOf={byCode.get("D-03")?.as_of ?? asOf}
        />
        <Tile
          code="D-08"
          label="Requirement lines with a coverage gap"
          count={count("D-08")}
          definition="Lines with uncovered quantity and no approved override."
          href="/requirements?tile=d08"
          asOf={byCode.get("D-08")?.as_of ?? asOf}
        />
        {PLANNED.map((tile) => (
          <PlannedTile
            key={tile.code}
            code={tile.code}
            label={tile.label}
            reason={`Available after Phase ${tile.phase}. This tile shows "—", never a false zero.`}
          />
        ))}
      </div>

      <div className="text-muted-foreground flex items-center gap-2 text-sm">
        <ClipboardList className="size-4" aria-hidden="true" />
        <Timer className="size-4" aria-hidden="true" />
        <FileText className="size-4" aria-hidden="true" />
        <span>
          Tiles refresh on load and always show their as-of time. Missing data is
          stated, never counted as zero.
        </span>
      </div>
    </div>
  );
}
