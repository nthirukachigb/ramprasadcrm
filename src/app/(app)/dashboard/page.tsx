import type { Metadata } from "next";
import { ChartNoAxesCombined } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = { title: "Dashboard" };

const KPI_PLACEHOLDERS = [
  { label: "Enquiries pending quotation", phase: 2 },
  { label: "Open orders", phase: 7 },
  { label: "Payments pending collection", phase: 9 },
  { label: "Orders at delivery risk", phase: 8 },
  { label: "Documents expiring", phase: 10 },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Live pipeline and order status each morning."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {KPI_PLACEHOLDERS.map((kpi) => (
          <Card key={kpi.label}>
            <CardHeader>
              <CardDescription>{kpi.label}</CardDescription>
              <CardTitle className="text-3xl tracking-tight">—</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-xs">
                No data yet · Coming in Phase {kpi.phase}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <EmptyState
        title="Dashboard tiles"
        purpose="Each tile will show a live count with a drill-down list, an as-of time and a definition tooltip."
        phase={12}
        icon={ChartNoAxesCombined}
      />
    </div>
  );
}
