"use client";

import {
  addApprovalCertificate,
  addApprovalRequirement,
  addBankAccount,
  addCommissionAgreement,
  addCustomerContact,
  addCustomerDivision,
  addCustomerLocation,
  addPartNumber,
  addPartnerCapability,
  addPartnerContact,
  addPartnerLocation,
  addPortalReference,
  addProductPrice,
  addTaxRegistration,
  createCustomer,
  createPartner,
  createProduct,
  linkPartnerProduct,
  type ActionResult,
} from "@/lib/masters/actions";
import {
  ADDRESS_TYPES,
  APPROVAL_TYPES,
  CONTACT_ROLES,
  CUSTOMER_TYPES,
  PART_NUMBER_TYPES,
  PARTNER_TYPES,
  PRICE_TYPES,
  RELATIONSHIP_TYPES,
  UOM_OPTIONS,
} from "@/lib/schemas/masters";

export interface SelectOption {
  value: string;
  label: string;
}

export type FieldType =
  | "text"
  | "number"
  | "date"
  | "textarea"
  | "select"
  | "checkbox"
  | "checkboxGroup"
  | "hidden";

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  options?: SelectOption[];
  /** Resolve options from the dialog's `options` prop by this key. */
  optionsKey?: string;
  placeholder?: string;
  help?: string;
  fullWidth?: boolean;
}

export interface FormSpec {
  title: string;
  description?: string;
  triggerLabel: string;
  submitLabel?: string;
  action: (input: unknown) => Promise<ActionResult>;
  fields: FieldDef[];
}

function titleCase(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function enumOptions(values: readonly string[]): SelectOption[] {
  return values.map((value) => ({ value, label: titleCase(value) }));
}

export const FORMS: Record<string, FormSpec> = {
  customer: {
    title: "New customer",
    triggerLabel: "New customer",
    action: createCustomer,
    fields: [
      { name: "name", label: "Organisation name", type: "text", fullWidth: true },
      { name: "legalName", label: "Legal name", type: "text" },
      {
        name: "customerType",
        label: "Type",
        type: "select",
        options: enumOptions(CUSTOMER_TYPES),
      },
      { name: "defaultPaymentTerms", label: "Default payment terms", type: "text" },
      {
        name: "defaultPaymentTermsDays",
        label: "Payment term days",
        type: "number",
      },
      { name: "notes", label: "Notes", type: "textarea", fullWidth: true },
    ],
  },
  customerDivision: {
    title: "New division",
    triggerLabel: "Add division",
    action: addCustomerDivision,
    fields: [
      { name: "customerId", label: "Customer", type: "hidden" },
      { name: "name", label: "Division name", type: "text", fullWidth: true },
      { name: "notes", label: "Notes", type: "textarea", fullWidth: true },
    ],
  },
  customerLocation: {
    title: "New location",
    triggerLabel: "Add location",
    action: addCustomerLocation,
    fields: [
      { name: "customerId", label: "Customer", type: "hidden" },
      {
        name: "divisionId",
        label: "Division",
        type: "select",
        optionsKey: "divisionId",
      },
      {
        name: "addressType",
        label: "Address type",
        type: "select",
        options: enumOptions(ADDRESS_TYPES),
      },
      { name: "label", label: "Label", type: "text" },
      { name: "addressLine1", label: "Address line 1", type: "text", fullWidth: true },
      { name: "addressLine2", label: "Address line 2", type: "text", fullWidth: true },
      { name: "city", label: "City", type: "text" },
      { name: "state", label: "State", type: "text" },
      { name: "postalCode", label: "Postal code", type: "text" },
      { name: "country", label: "Country", type: "text", placeholder: "India" },
      { name: "gstin", label: "GSTIN", type: "text" },
      { name: "isDefault", label: "Default location", type: "checkbox" },
    ],
  },
  customerContact: {
    title: "New contact",
    triggerLabel: "Add contact",
    action: addCustomerContact,
    fields: [
      { name: "customerId", label: "Customer", type: "hidden" },
      { name: "fullName", label: "Full name", type: "text" },
      { name: "designation", label: "Designation", type: "text" },
      {
        name: "role",
        label: "Role",
        type: "select",
        options: enumOptions(CONTACT_ROLES),
      },
      { name: "email", label: "Email", type: "text" },
      {
        name: "phoneE164",
        label: "Phone (E.164)",
        type: "text",
        placeholder: "+919876543210",
      },
      {
        name: "locationId",
        label: "Location",
        type: "select",
        optionsKey: "locationId",
      },
      { name: "isPrimary", label: "Primary contact", type: "checkbox" },
    ],
  },
  taxRegistration: {
    title: "New tax registration",
    description: "Stored encrypted. Only Owner, Finance and Admin can read it.",
    triggerLabel: "Add registration",
    action: addTaxRegistration,
    fields: [
      { name: "customerId", label: "Customer", type: "hidden" },
      {
        name: "registrationType",
        label: "Registration type",
        type: "text",
        placeholder: "GSTIN / PAN / vendor registration",
      },
      { name: "value", label: "Registration value", type: "text", fullWidth: true },
      { name: "validFrom", label: "Valid from", type: "date" },
      { name: "validTo", label: "Valid to", type: "date" },
      { name: "notes", label: "Notes", type: "textarea", fullWidth: true },
    ],
  },
  portalReference: {
    title: "New portal reference",
    description: "Store references only. Passwords and credentials are rejected.",
    triggerLabel: "Add portal reference",
    action: addPortalReference,
    fields: [
      { name: "customerId", label: "Customer", type: "hidden" },
      { name: "portalName", label: "Portal name", type: "text" },
      { name: "portalUrl", label: "Portal URL", type: "text" },
      { name: "responsibleUserId", label: "Responsible user id", type: "hidden" },
      { name: "notes", label: "Notes", type: "textarea", fullWidth: true },
    ],
  },
  product: {
    title: "New product",
    triggerLabel: "New product",
    action: createProduct,
    fields: [
      {
        name: "internalPartNumber",
        label: "Internal part number",
        type: "text",
      },
      { name: "description", label: "Description", type: "text", fullWidth: true },
      { name: "category", label: "Category", type: "text" },
      {
        name: "uom",
        label: "Unit of measure",
        type: "select",
        options: enumOptions(UOM_OPTIONS),
      },
      { name: "hsnCode", label: "HSN code", type: "text" },
      { name: "standardPrice", label: "Standard price", type: "number" },
      { name: "currency", label: "Currency", type: "text", placeholder: "INR" },
      { name: "moq", label: "MOQ", type: "number" },
      { name: "leadTimeDays", label: "Lead time (days)", type: "number" },
      { name: "shelfLifeDays", label: "Shelf life (days)", type: "number" },
      { name: "countryOfOrigin", label: "Country of origin", type: "text" },
      { name: "warrantyText", label: "Warranty", type: "text" },
      { name: "exportRestricted", label: "Export restricted", type: "checkbox" },
      { name: "technicalSpecs", label: "Technical specifications", type: "textarea", fullWidth: true },
    ],
  },
  partNumber: {
    title: "New part number",
    triggerLabel: "Add part number",
    action: addPartNumber,
    fields: [
      { name: "productId", label: "Product", type: "hidden" },
      {
        name: "partNumberType",
        label: "Type",
        type: "select",
        options: enumOptions(PART_NUMBER_TYPES),
      },
      { name: "value", label: "Part number", type: "text", fullWidth: true },
      {
        name: "customerId",
        label: "Customer",
        type: "select",
        optionsKey: "customerId",
        help: "For customer part numbers",
      },
      {
        name: "partnerId",
        label: "Partner",
        type: "select",
        optionsKey: "partnerId",
        help: "For OEM / manufacturer part numbers",
      },
    ],
  },
  approvalRequirement: {
    title: "Approval requirement",
    triggerLabel: "Add approval requirement",
    action: addApprovalRequirement,
    fields: [
      { name: "productId", label: "Product", type: "hidden" },
      {
        name: "approvalType",
        label: "Approval type",
        type: "select",
        options: enumOptions(APPROVAL_TYPES),
      },
      { name: "isRequired", label: "Required", type: "checkbox" },
      { name: "notes", label: "Notes", type: "textarea", fullWidth: true },
    ],
  },
  approvalCertificate: {
    title: "Approval certificate",
    description: "Evidence on file only — the system does not certify.",
    triggerLabel: "Add certificate",
    action: addApprovalCertificate,
    fields: [
      { name: "productId", label: "Product", type: "hidden" },
      {
        name: "approvalType",
        label: "Approval type",
        type: "select",
        options: enumOptions(APPROVAL_TYPES),
      },
      { name: "certificateNumber", label: "Certificate number", type: "text" },
      { name: "issuedBy", label: "Issued by", type: "text" },
      { name: "validFrom", label: "Valid from", type: "date" },
      { name: "validTo", label: "Valid to", type: "date" },
      { name: "documentReference", label: "Document reference", type: "text", fullWidth: true },
    ],
  },
  productPrice: {
    title: "Price record",
    triggerLabel: "Add price",
    action: addProductPrice,
    fields: [
      { name: "productId", label: "Product", type: "hidden" },
      {
        name: "priceType",
        label: "Price type",
        type: "select",
        options: enumOptions(PRICE_TYPES),
      },
      { name: "amount", label: "Amount", type: "number" },
      { name: "currency", label: "Currency", type: "text", placeholder: "INR" },
      {
        name: "partnerId",
        label: "Partner",
        type: "select",
        optionsKey: "partnerId",
      },
      { name: "validFrom", label: "Valid from", type: "date" },
      { name: "validTo", label: "Valid to", type: "date" },
      { name: "source", label: "Source", type: "text" },
      { name: "notes", label: "Notes", type: "textarea", fullWidth: true },
    ],
  },
  partner: {
    title: "New partner",
    triggerLabel: "New partner",
    action: createPartner,
    fields: [
      { name: "name", label: "Organisation name", type: "text", fullWidth: true },
      {
        name: "types",
        label: "Partner types",
        type: "checkboxGroup",
        options: enumOptions(PARTNER_TYPES),
        fullWidth: true,
      },
      { name: "legalName", label: "Legal name", type: "text" },
      { name: "country", label: "Country", type: "text", placeholder: "India" },
      { name: "vendorCode", label: "Vendor code", type: "text" },
      {
        name: "isDefenceQualified",
        label: "Defence-qualified (evidence on file)",
        type: "checkbox",
      },
      { name: "qualificationNotes", label: "Qualification notes", type: "textarea", fullWidth: true },
      { name: "notes", label: "Notes", type: "textarea", fullWidth: true },
    ],
  },
  partnerLocation: {
    title: "New partner location",
    triggerLabel: "Add location",
    action: addPartnerLocation,
    fields: [
      { name: "partnerId", label: "Partner", type: "hidden" },
      {
        name: "addressType",
        label: "Address type",
        type: "select",
        options: enumOptions(ADDRESS_TYPES),
      },
      { name: "label", label: "Label", type: "text" },
      { name: "addressLine1", label: "Address line 1", type: "text", fullWidth: true },
      { name: "addressLine2", label: "Address line 2", type: "text", fullWidth: true },
      { name: "city", label: "City", type: "text" },
      { name: "state", label: "State", type: "text" },
      { name: "postalCode", label: "Postal code", type: "text" },
      { name: "country", label: "Country", type: "text", placeholder: "India" },
      { name: "gstin", label: "GSTIN", type: "text" },
      { name: "isDefault", label: "Default location", type: "checkbox" },
    ],
  },
  partnerContact: {
    title: "New partner contact",
    triggerLabel: "Add contact",
    action: addPartnerContact,
    fields: [
      { name: "partnerId", label: "Partner", type: "hidden" },
      { name: "fullName", label: "Full name", type: "text" },
      { name: "designation", label: "Designation", type: "text" },
      {
        name: "role",
        label: "Role",
        type: "select",
        options: enumOptions(CONTACT_ROLES),
      },
      { name: "email", label: "Email", type: "text" },
      { name: "phoneE164", label: "Phone (E.164)", type: "text" },
      {
        name: "locationId",
        label: "Location",
        type: "select",
        optionsKey: "locationId",
      },
      { name: "isPrimary", label: "Primary contact", type: "checkbox" },
    ],
  },
  partnerCapability: {
    title: "New capability",
    triggerLabel: "Add capability",
    action: addPartnerCapability,
    fields: [
      { name: "partnerId", label: "Partner", type: "hidden" },
      { name: "capability", label: "Capability", type: "text", fullWidth: true },
      { name: "notes", label: "Notes", type: "textarea", fullWidth: true },
    ],
  },
  bankAccount: {
    title: "Bank details",
    description: "Encrypted at rest. Visible to Owner and Finance only.",
    triggerLabel: "Add bank details",
    action: addBankAccount,
    fields: [
      { name: "partnerId", label: "Partner", type: "hidden" },
      { name: "accountName", label: "Account name", type: "text" },
      { name: "accountNumber", label: "Account number", type: "text" },
      { name: "ifsc", label: "IFSC", type: "text" },
      { name: "bankName", label: "Bank name", type: "text" },
      { name: "branch", label: "Branch", type: "text" },
      { name: "swift", label: "SWIFT (optional)", type: "text" },
    ],
  },
  commissionAgreement: {
    title: "Commission agreement",
    description: "Overlapping periods for the same partner are rejected.",
    triggerLabel: "Add agreement",
    action: addCommissionAgreement,
    fields: [
      { name: "partnerId", label: "Partner", type: "hidden" },
      { name: "commissionPercent", label: "Commission %", type: "number" },
      { name: "effectiveFrom", label: "Effective from", type: "date" },
      { name: "effectiveTo", label: "Effective to", type: "date" },
      { name: "pricingValidityDays", label: "Pricing validity (days)", type: "number" },
      { name: "freightTerms", label: "Freight terms", type: "text" },
      { name: "warrantyTerms", label: "Warranty terms", type: "text" },
      { name: "moqRule", label: "MOQ rule", type: "text" },
      { name: "ndaStatus", label: "NDA / agreement status", type: "text" },
      { name: "notes", label: "Notes", type: "textarea", fullWidth: true },
    ],
  },
  partnerProduct: {
    title: "Link partner to product",
    description:
      "Adding a second represented OEM to an exclusive product needs Owner approval (override).",
    triggerLabel: "Link product",
    action: linkPartnerProduct,
    fields: [
      { name: "partnerId", label: "Partner", type: "hidden" },
      {
        name: "productId",
        label: "Product",
        type: "select",
        optionsKey: "productId",
        fullWidth: true,
      },
      {
        name: "relationshipType",
        label: "Relationship",
        type: "select",
        options: enumOptions(RELATIONSHIP_TYPES),
      },
      { name: "exclusiveRepresentation", label: "Exclusive representation", type: "checkbox" },
      { name: "leadTimeDays", label: "Lead time (days)", type: "number" },
      { name: "moq", label: "MOQ", type: "number" },
      { name: "priceValidUntil", label: "Price valid until", type: "date" },
      { name: "approvedSource", label: "Approved source (business-provided)", type: "checkbox" },
      { name: "approvedEvidence", label: "Approved-source evidence", type: "text", fullWidth: true },
      { name: "notes", label: "Notes", type: "textarea", fullWidth: true },
      {
        name: "override",
        label: "Owner override (exclusivity conflict)",
        type: "checkbox",
      },
      { name: "reason", label: "Reason", type: "textarea", fullWidth: true },
    ],
  },
};
