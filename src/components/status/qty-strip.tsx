import { formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface QtyStripProps {
  required: number;
  indicated: number;
  committed: number;
  uncovered: number;
  uom: string | null;
  hasOverride: boolean;
  uomConflict?: boolean;
  className?: string;
}

/**
 * Per-line quantity strip: required / committed / uncovered, with availability
 * (indication) shown separately and never added to coverage (BR-10, FR-QTY-04).
 * Status is always written in words as well as colour (accessibility).
 */
export function QtyStrip({
  required,
  indicated,
  committed,
  uncovered,
  uom,
  hasOverride,
  uomConflict,
  className,
}: QtyStripProps) {
  if (uomConflict || !uom) {
    return (
      <div className={cn("text-muted-foreground text-xs", className)}>
        UoM conflict – cannot compare
      </div>
    );
  }

  const scale = Math.max(required, committed, indicated, 1);
  const committedPct = Math.min(100, (committed / scale) * 100);
  const uncoveredPct = Math.min(100, (uncovered / scale) * 100);
  const indicatedPct = Math.min(100, (indicated / scale) * 100);

  const covered = uncovered <= 0;
  const label = covered
    ? "Covered"
    : hasOverride
      ? "Committed with override"
      : `Uncovered ${formatQty(uncovered)} ${uom}`;

  return (
    <div className={cn("space-y-1", className)}>
      <div
        className="bg-muted relative h-3 w-full overflow-hidden rounded"
        role="img"
        aria-label={`Required ${formatQty(required)} ${uom}, committed ${formatQty(committed)}, ${label}`}
      >
        <div
          className="bg-emerald-500 absolute inset-y-0 left-0"
          style={{ width: `${committedPct}%` }}
        />
        {uncoveredPct > 0 ? (
          <div
            className={cn(
              "absolute inset-y-0",
              hasOverride ? "bg-amber-400" : "bg-red-500",
            )}
            style={{ left: `${committedPct}%`, width: `${uncoveredPct}%` }}
          />
        ) : null}
      </div>

      {indicatedPct > 0 ? (
        <div
          className="h-2 w-full rounded border border-dashed border-sky-400"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, rgba(56,189,248,0.35) 0 4px, transparent 4px 8px)",
            width: `${indicatedPct}%`,
          }}
          title="Availability indication (informational, never counted as coverage)"
          aria-hidden="true"
        />
      ) : null}

      <p className="text-xs">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {" "}
          · required {formatQty(required)} · committed {formatQty(committed)}
          {indicated > 0
            ? ` · available ${formatQty(indicated)} (informational, not counted)`
            : ""}
        </span>
      </p>
    </div>
  );
}
