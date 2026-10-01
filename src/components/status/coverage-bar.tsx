import { formatQty } from "@/lib/format";

export interface CoverageBarProps {
  totalRequired: number;
  totalCommitted: number;
  totalUncovered: number;
  gapLines: number;
  totalLines: number;
}

/**
 * Summary coverage bar across a requirement's lines. Uses the same committed
 * figures as the per-line strips (single source: v_requirement_line_coverage).
 */
export function CoverageBar({
  totalRequired,
  totalCommitted,
  totalUncovered,
  gapLines,
  totalLines,
}: CoverageBarProps) {
  const scale = Math.max(totalRequired, totalCommitted, 1);
  const committedPct = Math.min(100, (totalCommitted / scale) * 100);
  const uncoveredPct = Math.min(100, (totalUncovered / scale) * 100);
  const covered = totalUncovered <= 0;

  return (
    <div className="space-y-2">
      <div
        className="bg-muted relative h-4 w-full overflow-hidden rounded"
        role="img"
        aria-label={`${covered ? "Fully covered" : `Uncovered ${formatQty(totalUncovered)}`} across ${totalLines} line(s)`}
      >
        <div className="bg-emerald-500 absolute inset-y-0 left-0" style={{ width: `${committedPct}%` }} />
        {uncoveredPct > 0 ? (
          <div
            className="bg-red-500 absolute inset-y-0"
            style={{ left: `${committedPct}%`, width: `${uncoveredPct}%` }}
          />
        ) : null}
      </div>
      <p className="text-sm">
        <span className="font-medium">
          {covered ? "Fully covered" : `Uncovered ${formatQty(totalUncovered)}`}
        </span>
        <span className="text-muted-foreground">
          {" "}
          · committed {formatQty(totalCommitted)} of {formatQty(totalRequired)} across{" "}
          {totalLines} line(s)
          {gapLines > 0 ? ` · ${gapLines} line(s) with a gap` : ""}
        </span>
      </p>
    </div>
  );
}
