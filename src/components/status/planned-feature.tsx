import { Construction } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Honest "not built yet" marker. It never shows fake numbers or working
 * buttons — only the feature and when it is planned (Plan §11).
 */
export function PlannedFeature({
  label,
  reason,
  className,
}: {
  label: string;
  reason: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-muted-foreground flex items-start gap-2 rounded-md border border-dashed p-3 text-sm",
        className,
      )}
    >
      <Construction className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-xs">{reason}</p>
      </div>
    </div>
  );
}
