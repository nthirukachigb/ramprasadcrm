import { z } from "zod";

export const SOURCING_REQUEST_STATUSES = [
  "draft",
  "sent",
  "responded",
  "partially_responded",
  "declined",
  "overdue",
  "cancelled",
] as const;

export const OEM_RESPONSE_STATUSES = [
  "received",
  "under_evaluation",
  "accepted_for_quotation",
  "rejected",
  "superseded",
] as const;

export const COMMITMENT_STATUSES = [
  "active",
  "changed",
  "withdrawn",
  "expired",
  "consumed",
] as const;

export const OEM_SELECTION_STATUSES = ["proposed", "approved", "rejected"] as const;

export type SourcingRequestStatus = (typeof SOURCING_REQUEST_STATUSES)[number];

export const SOURCING_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  sent: "Sent",
  responded: "Responded",
  partially_responded: "Partially responded",
  declined: "Declined",
  overdue: "Overdue",
  cancelled: "Cancelled",
  received: "Received",
  under_evaluation: "Under evaluation",
  accepted_for_quotation: "Accepted for quotation",
  rejected: "Rejected",
  superseded: "Superseded",
  active: "Active",
  changed: "Changed",
  withdrawn: "Withdrawn",
  expired: "Expired",
  consumed: "Consumed",
  proposed: "Proposed",
  approved: "Approved",
};

const uuid = z.string().uuid();
const optionalText = z
  .string()
  .trim()
  .transform((value) => (value === "" ? undefined : value))
  .optional();
const optionalDate = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
    .optional(),
);
const optionalNumber = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.coerce.number().nonnegative().optional(),
);
const optionalInt = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.coerce.number().int().nonnegative().optional(),
);

/** T3.2 — confirm shortlisted partners per line. */
export const confirmShortlistSchema = z.object({
  requirementId: uuid,
  selections: z
    .array(
      z.object({
        requirementLineId: uuid,
        partnerIds: z.array(uuid),
      }),
    )
    .min(1),
});

/** T3.3 — create a sourcing request to one partner. */
export const sourcingRequestSchema = z.object({
  requirementId: uuid,
  partnerId: uuid,
  responseDueDate: optionalDate,
  channel: optionalText,
  lineIds: z.array(uuid).min(1, "Select at least one line"),
  markSent: z.boolean().default(false),
});

export const responseLineSchema = z
  .object({
    sourcingRequestLineId: uuid,
    unitPrice: optionalNumber,
    leadTimeDays: optionalInt,
    moq: optionalNumber,
    validityUntil: optionalDate,
    availability: optionalNumber,
    commitmentQty: optionalNumber,
    commitmentNote: optionalText,
  })
  .refine(
    (value) =>
      value.commitmentQty === undefined ||
      (value.commitmentNote !== undefined && value.commitmentNote.length >= 3),
    {
      message:
        "A firm commitment needs evidence: a confirmation note of at least 3 characters",
      path: ["commitmentNote"],
    },
  );

/** T3.3 — capture an OEM response, availability and commitment kept separate. */
export const oemResponseSchema = z.object({
  requestId: uuid,
  partnerId: uuid,
  responseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Response date is required"),
  partnerQuotationNo: optionalText,
  notes: optionalText,
  lines: z.array(responseLineSchema).min(1, "Add at least one response line"),
});

export const commitmentChangeSchema = z.object({
  id: uuid,
  newQty: z.coerce.number().positive("The new quantity must be greater than zero"),
  reason: z.string().trim().min(3, "A reason is required"),
});

export const commitmentWithdrawSchema = z.object({
  id: uuid,
  reason: z.string().trim().min(3, "A reason is required"),
});

export const selectionSchema = z.object({
  requirementId: uuid,
  requirementLineId: uuid,
  partnerId: uuid,
  qtyAllocated: z.coerce.number().positive("Quantity must be greater than zero"),
  notes: optionalText,
});

export type ConfirmShortlistInput = z.infer<typeof confirmShortlistSchema>;
export type SourcingRequestInput = z.infer<typeof sourcingRequestSchema>;
export type OemResponseInput = z.infer<typeof oemResponseSchema>;
export type SelectionInput = z.infer<typeof selectionSchema>;
