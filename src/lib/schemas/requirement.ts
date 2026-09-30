import { z } from "zod";

export const REQUIREMENT_TYPES = [
  "rfi",
  "rfq",
  "enquiry",
  "tender",
  "repeat",
  "budgetary",
] as const;

export const SOURCE_CHANNELS = [
  "gem",
  "buyer_portal",
  "email",
  "direct",
  "primary_client",
  "oem",
  "other",
] as const;

export const BID_TYPES = ["single", "double", "other"] as const;
export const SUBMISSION_TYPES = ["hard", "soft", "both"] as const;

export const REQUIREMENT_STATUSES = [
  "received",
  "qualifying",
  "in_preparation",
  "quoted",
  "submitted",
  "won",
  "partially_won",
  "lost",
  "not_pursued",
  "cancelled",
  "closed",
] as const;

export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

/** Human labels for select controls and badges. */
export const REQUIREMENT_TYPE_LABELS: Record<string, string> = {
  rfi: "RFI",
  rfq: "RFQ",
  enquiry: "Enquiry",
  tender: "Tender",
  repeat: "Repeat",
  budgetary: "Budgetary",
};

export const SOURCE_CHANNEL_LABELS: Record<string, string> = {
  gem: "GeM",
  buyer_portal: "Buyer portal",
  email: "Email",
  direct: "Direct",
  primary_client: "Primary client",
  oem: "OEM",
  other: "Other",
};

export const STATUS_LABELS: Record<string, string> = {
  received: "Received",
  qualifying: "Qualifying",
  in_preparation: "In preparation",
  quoted: "Quoted",
  submitted: "Submitted",
  won: "Won",
  partially_won: "Partially won",
  lost: "Lost",
  not_pursued: "Not pursued",
  cancelled: "Cancelled",
  closed: "Closed",
};

export function labelFor(
  map: Record<string, string>,
  value: string | null | undefined,
): string {
  if (!value) return "—";
  return map[value] ?? value;
}

const uuid = z.string().uuid("Select a valid record");

const optionalText = z
  .string()
  .trim()
  .transform((value) => (value === "" ? undefined : value))
  .optional();

const optionalUuid = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z.string().uuid().optional(),
);

const optionalDate = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date")
    .optional(),
);

const optionalDateTime = z.preprocess(
  (value) => (value === "" || value === null ? undefined : value),
  z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/,
      "Use a valid date and time",
    )
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

const optionalBoolean = z.preprocess(
  (value) => value === true || value === "true" || value === "on",
  z.boolean(),
);

/** Create / edit a requirement header (FR-RFI-01). */
export const requirementSchema = z.object({
  requirementType: z.enum(REQUIREMENT_TYPES),
  customerId: uuid,
  divisionId: optionalUuid,
  locationId: optionalUuid,
  primaryClientId: optionalUuid,
  projectName: optionalText,
  sourceChannel: z.enum(SOURCE_CHANNELS),
  sourceDetail: optionalText,
  customerReference: z
    .string()
    .trim()
    .min(1, "Customer reference is required"),
  portalTenderNo: optionalText,
  enquiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enquiry date is required"),
  receivedDate: optionalDate,
  submissionDeadline: optionalDateTime,
  deadlineTbc: optionalBoolean.default(false),
  clarificationDeadline: optionalDateTime,
  quotationValidityRequiredDays: optionalInt,
  bidType: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.enum(BID_TYPES).optional(),
  ),
  submissionType: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.enum(SUBMISSION_TYPES).optional(),
  ),
  staggeredDelivery: optionalBoolean.default(false),
  requiredDeliverySummary: optionalText,
  paymentTermsRequested: optionalText,
  approvalRequirementsSummary: optionalText,
  assignedUserId: optionalUuid,
  estimatedValue: optionalNumber,
  notes: optionalText,
});

export type RequirementInput = z.infer<typeof requirementSchema>;

export const requirementUpdateSchema = requirementSchema.extend({
  id: z.string().uuid(),
});

/** Which statuses each role may move a requirement to is enforced in SQL. */
export const statusChangeSchema = z.object({
  id: z.string().uuid(),
  toStatus: z.enum(REQUIREMENT_STATUSES),
  reason: optionalText,
});

export const qualificationSchema = z
  .object({
    requirementId: z.string().uuid(),
    decision: z.enum(["pursue", "pass"]),
    reason: z.string().trim().optional(),
    note: optionalText,
  })
  .refine(
    (value) =>
      value.decision !== "pass" ||
      (value.reason !== undefined && value.reason.length >= 3),
    {
      message: "A pass reason of at least 3 characters is required",
      path: ["reason"],
    },
  );

export type QualificationInput = z.infer<typeof qualificationSchema>;

/** One row in the 500-line grid (T2.3). */
export const requirementLineInputSchema = z.object({
  id: optionalUuid,
  line_no: z.coerce.number().int().positive("Line number must be positive"),
  product_id: optionalUuid,
  customer_part_no: optionalText,
  oem_part_no: optionalText,
  internal_part_no: optionalText,
  description: z.string().trim().min(1, "Description is required"),
  specification_ref: optionalText,
  drawing_revision: optionalText,
  quantity_required: z.coerce
    .number()
    .positive("Quantity must be greater than zero"),
  uom: z.string().trim().min(1, "UoM is required"),
  required_delivery_date: optionalDate,
  required_delivery_period: optionalText,
  line_notes: optionalText,
  approval_types_required: z.array(z.string()).default([]),
});

export type RequirementLineInput = z.infer<typeof requirementLineInputSchema>;

export const saveLinesSchema = z.object({
  requirementId: z.string().uuid(),
  lines: z
    .array(requirementLineInputSchema)
    .max(500, "A requirement can hold at most 500 lines"),
});

export const clarificationSchema = z.object({
  requirementId: z.string().uuid(),
  requirementLineId: optionalUuid,
  clarificationType: z
    .enum([
      "missing_specification",
      "missing_drawing",
      "outdated_drawing",
      "part_number_discrepancy",
      "other",
    ])
    .default("other"),
  subject: z.string().trim().min(1, "Subject is required"),
  detail: optionalText,
  ownerUserId: optionalUuid,
  dueDate: optionalDate,
});

export const clarificationResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["open", "responded", "closed"]),
  responseText: optionalText,
});
