import { StatusBadge } from "@/components/status-badge";
import { certificateStatus } from "@/lib/masters/status";

export function EvidenceBadge({
  validTo,
  now,
}: {
  validTo?: string | null;
  now?: Date;
}) {
  const status = certificateStatus(validTo ?? null, now ?? new Date(), 45);
  const label =
    status === "valid"
      ? "Evidence on file (valid)"
      : status === "expiring"
        ? "Expiring in 45 days"
        : status === "expired"
          ? "Expired"
          : "No evidence";

  const tone =
    status === "valid"
      ? "success"
      : status === "expiring"
        ? "warning"
        : status === "expired"
          ? "danger"
          : "neutral";

  return <StatusBadge status={label} tone={tone} />;
}
