import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: "border-transparent bg-muted text-muted-foreground",
  info: "border-transparent bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  success:
    "border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  warning:
    "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  danger:
    "border-transparent bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
};

/**
 * Controlled status label. Colour is always paired with text, never colour
 * alone. Tones are mapped by status string so later phases can extend the map.
 */
export function StatusBadge({
  status,
  tone = "neutral",
  className,
}: {
  status: string;
  tone?: StatusTone;
  className?: string;
}) {
  return (
    <Badge className={cn(TONE_CLASSES[tone], className)}>
      <span className="capitalize">{status}</span>
    </Badge>
  );
}

export type { StatusTone };
