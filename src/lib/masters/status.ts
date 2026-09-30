export type ApprovalStatus = "no_evidence" | "expired" | "expiring" | "valid";

/**
 * Status of an approval certificate. A certificate with no expiry recorded is
 * treated as valid ("evidence on file"); the system never claims compliance,
 * only that evidence exists.
 */
export function certificateStatus(
  validTo: string | null | undefined,
  now: Date = new Date(),
  expiringDays = 60,
): ApprovalStatus {
  if (!validTo) return "valid";
  const expiry = new Date(validTo);
  if (Number.isNaN(expiry.getTime())) return "no_evidence";
  const diffMs = expiry.getTime() - now.getTime();
  if (diffMs < 0) return "expired";
  if (diffMs <= expiringDays * 24 * 60 * 60 * 1000) return "expiring";
  return "valid";
}

export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  no_evidence: "No evidence",
  expired: "Expired",
  expiring: "Expiring",
  valid: "Evidence on file (valid)",
};
