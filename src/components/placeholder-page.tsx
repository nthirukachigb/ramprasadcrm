import type { LucideIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

interface PlaceholderPageProps {
  title: string;
  purpose: string;
  phase: number | string;
  icon?: LucideIcon;
}

/** Shared body for every Phase 0 module placeholder. */
export function PlaceholderPage({
  title,
  purpose,
  phase,
  icon,
}: PlaceholderPageProps) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={purpose} />
      <EmptyState title={title} purpose={purpose} phase={phase} icon={icon} />
    </div>
  );
}
