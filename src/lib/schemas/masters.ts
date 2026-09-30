import { z } from "zod";

/** Lowercase and collapse internal whitespace. Mirrors the DB generated columns. */
export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

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

const requiredDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");

const email = z
  .string()
  .trim()
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Enter a valid email address");

const e164 = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{6,14}$/, "Use E.164 format, e.g. +919876543210");

export const UOM_OPTIONS = [
  "EA",
  "NO",
  "SET",
  "PKG",
  "BOX",
  "PAIR",
  "KG",
  "G",
  "LTR",
  "M",
  "SQ M",
  "ROLL",
] as const;

export const ADDRESS_TYPES = [
  "billing",
  "delivery",
  "correspondence",
  "registered",
  "other",
] as const;

export const CONTACT_ROLES = [
  "purchase",
  "qa",
  "inspector",
  "finance",
  "technical",
  "management",
  "other",
] as const;

export const PART_NUMBER_TYPES = [
  "internal",
  "customer",
  "oem",
  "manufacturer",
] as const;

export const APPROVAL_TYPES = [
  "none",
  "rcma",
  "cemilac",
  "lcso",
  "dgqa",
  "mil_standard",
  "iso_9001",
  "as9100",
] as const;

export const PRICE_TYPES = [
  "oem_cost",
  "quoted",
  "negotiated",
  "po",
] as const;

export const PARTNER_TYPES = [
  "oem",
  "supplier",
  "subcontractor",
  "manufacturer",
  "logistics_provider",
  "inspection_agency",
  "approval_authority",
  "competitor",
  "agency",
] as const;

export const RELATIONSHIP_TYPES = [
  "represented_oem",
  "alternate_source",
  "subcontract_capability",
] as const;

export const CUSTOMER_TYPES = [
  "government",
  "defence_agency",
  "psu",
  "service",
  "private",
  "other",
] as const;

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------
export const customerSchema = z.object({
  name: z.string().trim().min(2, "Customer name is required").max(200),
  legalName: optionalText,
  customerType: z.enum(CUSTOMER_TYPES).optional(),
  defaultPaymentTerms: optionalText,
  defaultPaymentTermsDays: z.coerce.number().int().min(0).max(365).optional(),
  notes: optionalText,
});
export type CustomerInput = z.infer<typeof customerSchema>;

export const customerDivisionSchema = z.object({
  customerId: z.string().uuid(),
  name: z.string().trim().min(2, "Division name is required").max(200),
  notes: optionalText,
});

export const customerLocationSchema = z.object({
  customerId: z.string().uuid(),
  divisionId: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().uuid().optional(),
  ),
  label: optionalText,
  addressType: z.enum(ADDRESS_TYPES),
  addressLine1: optionalText,
  addressLine2: optionalText,
  city: optionalText,
  state: optionalText,
  postalCode: optionalText,
  country: z.string().trim().default("India"),
  gstin: optionalText,
  isDefault: z.coerce.boolean().default(false),
});

export const customerContactSchema = z.object({
  customerId: z.string().uuid(),
  divisionId: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().uuid().optional(),
  ),
  locationId: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().uuid().optional(),
  ),
  fullName: z.string().trim().min(2, "Contact name is required").max(200),
  designation: optionalText,
  role: z.enum(CONTACT_ROLES).optional(),
  email: z.union([email, z.literal("")]).optional(),
  phoneE164: z.union([e164, z.literal("")]).optional(),
  isPrimary: z.coerce.boolean().default(false),
});

export const taxRegistrationSchema = z.object({
  customerId: z.string().uuid(),
  registrationType: z.string().trim().min(2, "Registration type is required"),
  value: z.string().trim().min(3, "Registration value is required"),
  validFrom: optionalDate,
  validTo: optionalDate,
  notes: optionalText,
});
export type TaxRegistrationInput = z.infer<typeof taxRegistrationSchema>;

const CREDENTIAL_PATTERNS = [
  /password\s*[:=]/i,
  /passwd\s*[:=]/i,
  /secret\s*[:=]/i,
  /api[_-]?key\s*[:=]/i,
  /token\s*[:=]/i,
  /pwd\s*[:=]/i,
];

/** Rejects text that looks like a stored credential (PRD FR-CUST-04 / NG-12). */
export function containsCredentialLikeText(value: string): boolean {
  return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(value));
}

export const portalReferenceSchema = z
  .object({
    customerId: z.string().uuid(),
    portalName: z.string().trim().min(2, "Portal name is required"),
    portalUrl: optionalText,
    responsibleUserId: z.preprocess(
      (value) => (value === "" || value === null ? undefined : value),
      z.string().uuid().optional(),
    ),
    notes: optionalText,
  })
  .superRefine((value, ctx) => {
    const haystack = [value.portalName, value.portalUrl, value.notes]
      .filter(Boolean)
      .join(" ");
    if (containsCredentialLikeText(haystack)) {
      ctx.addIssue({
        code: "custom",
        path: ["notes"],
        message:
          "Do not store passwords or credentials. This field must contain a reference only.",
      });
    }
  });

// ---------------------------------------------------------------------------
// Product and parts
// ---------------------------------------------------------------------------
export const productSchema = z.object({
  internalPartNumber: z
    .string()
    .trim()
    .min(1, "Internal part number is required")
    .max(120),
  description: z.string().trim().min(2, "Description is required").max(500),
  category: optionalText,
  uom: z.enum(UOM_OPTIONS, { message: "Unit of measure is required" }),
  hsnCode: z
    .union([z.string().trim().regex(/^\d{4,8}$/, "HSN must be 4 to 8 digits"), z.literal("")])
    .optional(),
  technicalSpecs: optionalText,
  moq: z.coerce.number().min(0).optional(),
  leadTimeDays: z.coerce.number().int().min(0).optional(),
  shelfLifeDays: z.coerce.number().int().min(0).optional(),
  warrantyText: optionalText,
  countryOfOrigin: optionalText,
  exportRestricted: z.coerce.boolean().default(false),
  standardPrice: z.coerce.number().min(0).optional(),
  currency: z.string().trim().default("INR"),
});
export type ProductInput = z.infer<typeof productSchema>;

export const partNumberSchema = z.object({
  productId: z.string().uuid(),
  partNumberType: z.enum(PART_NUMBER_TYPES),
  customerId: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().uuid().optional(),
  ),
  partnerId: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().uuid().optional(),
  ),
  value: z.string().trim().min(1, "Part number is required").max(200),
});

export const approvalRequirementSchema = z.object({
  productId: z.string().uuid(),
  approvalType: z.enum(APPROVAL_TYPES),
  isRequired: z.coerce.boolean().default(true),
  notes: optionalText,
});

export const approvalCertificateSchema = z
  .object({
    productId: z.string().uuid(),
    approvalType: z.enum(APPROVAL_TYPES),
    certificateNumber: optionalText,
    issuedBy: optionalText,
    validFrom: optionalDate,
    validTo: optionalDate,
    documentReference: optionalText,
  })
  .refine(
    (value) =>
      !value.validFrom ||
      !value.validTo ||
      value.validTo >= value.validFrom,
    { message: "Valid-to date must be on or after valid-from", path: ["validTo"] },
  );

export const productPriceSchema = z.object({
  productId: z.string().uuid(),
  partnerId: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().uuid().optional(),
  ),
  priceType: z.enum(PRICE_TYPES),
  amount: z.coerce.number().min(0, "Amount must be zero or more"),
  currency: z.string().trim().default("INR"),
  validFrom: optionalDate,
  validTo: optionalDate,
  source: optionalText,
  notes: optionalText,
});

// ---------------------------------------------------------------------------
// Partner
// ---------------------------------------------------------------------------
export const partnerSchema = z.object({
  name: z.string().trim().min(2, "Partner name is required").max(200),
  types: z.array(z.enum(PARTNER_TYPES)).min(1, "Select at least one partner type"),
  legalName: optionalText,
  country: z.string().trim().default("India"),
  vendorCode: optionalText,
  isDefenceQualified: z.coerce.boolean().default(false),
  qualificationNotes: optionalText,
  notes: optionalText,
});
export type PartnerInput = z.infer<typeof partnerSchema>;

export const partnerLocationSchema = z.object({
  partnerId: z.string().uuid(),
  label: optionalText,
  addressType: z.enum(ADDRESS_TYPES),
  addressLine1: optionalText,
  addressLine2: optionalText,
  city: optionalText,
  state: optionalText,
  postalCode: optionalText,
  country: z.string().trim().default("India"),
  gstin: optionalText,
  isDefault: z.coerce.boolean().default(false),
});

export const partnerContactSchema = z.object({
  partnerId: z.string().uuid(),
  locationId: z.preprocess(
    (value) => (value === "" || value === null ? undefined : value),
    z.string().uuid().optional(),
  ),
  fullName: z.string().trim().min(2, "Contact name is required").max(200),
  designation: optionalText,
  role: z.enum(CONTACT_ROLES).optional(),
  email: z.union([email, z.literal("")]).optional(),
  phoneE164: z.union([e164, z.literal("")]).optional(),
  isPrimary: z.coerce.boolean().default(false),
});

export const partnerCapabilitySchema = z.object({
  partnerId: z.string().uuid(),
  capability: z.string().trim().min(2, "Capability is required").max(300),
  notes: optionalText,
});

export const bankAccountSchema = z.object({
  partnerId: z.string().uuid(),
  accountName: z.string().trim().min(2, "Account name is required"),
  accountNumber: z.string().trim().min(4, "Account number is required"),
  ifsc: z
    .string()
    .trim()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, "Enter a valid IFSC code"),
  bankName: optionalText,
  branch: optionalText,
  swift: optionalText,
});
export type BankAccountInput = z.infer<typeof bankAccountSchema>;

export const commissionAgreementSchema = z
  .object({
    partnerId: z.string().uuid(),
    commissionPercent: z.coerce
      .number()
      .min(0, "Commission must be 0 or more")
      .max(100, "Commission must be 100 or less"),
    effectiveFrom: requiredDate,
    effectiveTo: optionalDate,
    pricingValidityDays: z.coerce.number().int().min(0).optional(),
    freightTerms: optionalText,
    warrantyTerms: optionalText,
    moqRule: optionalText,
    ndaStatus: optionalText,
    notes: optionalText,
  })
  .refine(
    (value) =>
      !value.effectiveTo || value.effectiveTo >= value.effectiveFrom,
    {
      message: "Effective-to must be on or after effective-from",
      path: ["effectiveTo"],
    },
  );
export type CommissionAgreementInput = z.infer<
  typeof commissionAgreementSchema
>;

export const partnerProductSchema = z.object({
  partnerId: z.string().uuid(),
  productId: z.string().uuid(),
  relationshipType: z.enum(RELATIONSHIP_TYPES),
  exclusiveRepresentation: z.coerce.boolean().default(false),
  leadTimeDays: z.coerce.number().int().min(0).optional(),
  moq: z.coerce.number().min(0).optional(),
  priceValidUntil: optionalDate,
  approvedSource: z.coerce.boolean().default(false),
  approvedEvidence: optionalText,
  notes: optionalText,
  override: z.coerce.boolean().default(false),
  reason: optionalText,
});
export type PartnerProductInput = z.infer<typeof partnerProductSchema>;
