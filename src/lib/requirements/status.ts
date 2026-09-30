import type { StatusTone } from "@/components/status-badge";
import {
  REQUIREMENT_STATUSES,
  type RequirementStatus,
} from "@/lib/schemas/requirement";

export const STATUS_TONES: Record<string, StatusTone> = {
  received: "info",
  qualifying: "info",
  in_preparation: "warning",
  quoted: "warning",
  submitted: "info",
  won: "success",
  partially_won: "success",
  lost: "danger",
  not_pursued: "neutral",
  cancelled: "neutral",
  closed: "neutral",
};

/** Allowed transitions, mirrored from ref.status_transition (PRD §21.1). */
export const NEXT_STATUSES: Record<string, RequirementStatus[]> = {
  received: ["qualifying", "not_pursued", "cancelled"],
  qualifying: ["in_preparation", "not_pursued", "cancelled"],
  in_preparation: ["quoted", "not_pursued", "cancelled"],
  quoted: ["submitted", "in_preparation", "cancelled"],
  submitted: ["won", "partially_won", "lost", "cancelled"],
  won: ["closed"],
  partially_won: ["closed"],
  lost: [],
  not_pursued: [],
  cancelled: [],
  closed: [],
};

export const TERMINAL_STATUSES: RequirementStatus[] = [
  "lost",
  "not_pursued",
  "cancelled",
  "closed",
];

export function isTerminal(status: string): boolean {
  return TERMINAL_STATUSES.includes(status as RequirementStatus);
}

export function nextStatuses(status: string): RequirementStatus[] {
  return NEXT_STATUSES[status] ?? [];
}

/** Statuses that need a reason and possibly an Owner approval. */
export const REASON_REQUIRED: RequirementStatus[] = [
  "not_pursued",
  "lost",
  "cancelled",
];

export const APPROVAL_REQUIRED: RequirementStatus[] = ["not_pursued"];

export function isRequirementStatus(value: string): value is RequirementStatus {
  return (REQUIREMENT_STATUSES as readonly string[]).includes(value);
}
