import type { LucideIcon } from "lucide-react";
import { Construction } from "lucide-react";

import { cn } from "@/lib/utils";

interface EmptyStateProps {
  title: string;
  purpose: string;
  phase?: number | string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  className?: string;
}

/**
 * The single placeholder used across every future module. It never shows fake
 * data or fake working buttons — only what the module will do and when.
 */
export function EmptyState({
  title,
  purpose,
  phase,
  icon: Icon = Construction,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-10 text-center",
        className,
      )}
    >
      <div className="bg-muted text-muted-foreground flex size-10 items-center justify-center rounded-full">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="text-muted-foreground max-w-md text-sm">{purpose}</p>
      {phase ? (
        <p className="text-muted-foreground mt-1 text-xs font-medium tracking-wide uppercase">
          Coming in Phase {phase}
        </p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
