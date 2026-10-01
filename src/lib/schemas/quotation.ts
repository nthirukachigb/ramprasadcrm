import { z } from "zod";

export const QUOTATION_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "submitted",
  "superseded",
  "discarded",
  "closed",
] as const;

export const QUOTATION_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending approval",
  approved: "Approved",
  rejected: "Rejected",
  submitted: "Submitted",
  superseded: "Superseded",
  discarded: "Discarded",
  closed: "Closed",
};

export const VERSION_REASONS = [
  "initial",
  "revised",
  "pnc",
  "cost_change",
  "clarification",
  "other",
] as const;

export const VERSION_REASON_LABELS: Record<string, string> = {
  initial: "Initial",
  revised: "Revised",
  pnc: "PNC",
  cost_change: "Cost change",
  clarification: "Clarification",
  other: "Other",
};

export const SOURCING_BASIS_OPTIONS = [
  { value: "oem_selected", label: "OEM selected" },
  { value: "customer_supplied", label: "Customer supplied" },
  { value: "in_house", label: "In-house" },
] as const;

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

export const quotationLineUpdateSchema = z.object({
  lineId: uuid,
  versionId: uuid,
  unitCost: optionalNumber,
  freightUnit: optionalNumber,
  otherCostUnit: optionalNumber,
  targetMarginPct: optionalNumber,
  proposedUnitPrice: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.coerce.number().positive("Proposed price must be greater than zero").optional(),
  ),
  leadTimeDays: optionalInt,
  sourcingBasis: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.enum(["oem_selected", "customer_supplied", "in_house"]).optional(),
  ),
  notes: optionalText,
});

export const quotationHeaderSchema = z.object({
  versionId: uuid,
  currency: z.string().trim().min(1).default("INR"),
  fxRate: z.coerce.number().positive().default(1),
  validUntil: optionalDate,
  deliveryTerms: optionalText,
  paymentTerms: optionalText,
  technicalCompliance: z.boolean().default(false),
  commercialCompliance: z.boolean().default(false),
});

export const taxLineSchema = z.object({
  versionId: uuid,
  taxType: z.string().trim().min(1, "Tax type is required"),
  ratePct: optionalNumber,
  taxableAmount: optionalNumber,
  amount: z.coerce.number().nonnegative("Amount cannot be negative"),
});

export const revisionSchema = z.object({
  versionId: uuid,
  reason: z.enum(VERSION_REASONS),
});

export const submissionSchema = z.object({
  versionId: uuid,
  mode: z.string().trim().min(1, "Submission mode is required"),
  at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/, "Use a valid date and time"),
  reference: optionalText,
  proofDocumentId: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().uuid().optional(),
  ),
  lateReason: optionalText,
});

export type QuotationLineUpdateInput = z.infer<typeof quotationLineUpdateSchema>;
export type QuotationHeaderInput = z.infer<typeof quotationHeaderSchema>;
