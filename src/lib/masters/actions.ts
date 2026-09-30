"use server";

import { revalidatePath } from "next/cache";
import type { ZodType } from "zod";

import { getCurrentUser, type AppRole } from "@/lib/auth/get-user";
import { encryptField, last4 } from "@/lib/crypto";
import {
  approvalCertificateSchema,
  approvalRequirementSchema,
  bankAccountSchema,
  commissionAgreementSchema,
  customerContactSchema,
  customerDivisionSchema,
  customerLocationSchema,
  customerSchema,
  partNumberSchema,
  partnerCapabilitySchema,
  partnerContactSchema,
  partnerLocationSchema,
  partnerProductSchema,
  partnerSchema,
  portalReferenceSchema,
  productPriceSchema,
  productSchema,
  taxRegistrationSchema,
} from "@/lib/schemas/masters";
import { createClient } from "@/lib/supabase/server";

export type ActionResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

const WRITE_ROLES: AppRole[] = ["owner", "sales", "operations", "admin"];

function friendly(message: string, code?: string): string {
  if (code === "23505" || /duplicate key/i.test(message)) {
    return "A record with this name or number already exists.";
  }
  if (message.includes("EXCLUSIVITY_CONFLICT")) {
    return "This product already has an exclusive represented OEM. Owner approval is required to add another.";
  }
  if (message.includes("OVERLAPPING_AGREEMENT")) {
    return "This partner already has an agreement covering that period. Adjust the dates.";
  }
  if (message.includes("FORBIDDEN")) {
    return "You do not have permission to do that.";
  }
  if (/row-level security|permission denied/i.test(message)) {
    return "You do not have permission to change this record.";
  }
  return "Could not save. Please check the values and try again.";
}

async function guard(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (!user.roles.some((role) => WRITE_ROLES.includes(role))) {
    return { ok: false, error: "You do not have permission to change master data." };
  }
  return { ok: true, userId: user.id };
}

function parse<T>(
  schema: ZodType<T>,
  input: unknown,
): { ok: true; data: T } | { ok: false; error: string } {
  const result = schema.safeParse(input);
  if (!result.success) {
    return {
      ok: false,
      error: result.error.issues[0]?.message ?? "Please check the values.",
    };
  }
  return { ok: true, data: result.data };
}

function touch(...paths: string[]) {
  for (const path of paths) revalidatePath(path);
}

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------
export async function createCustomer(input: unknown): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const p = parse(customerSchema, input);
  if (!p.ok) return p;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("customer")
    .insert({
      name: p.data.name,
      legal_name: p.data.legalName ?? null,
      customer_type: p.data.customerType ?? null,
      default_payment_terms: p.data.defaultPaymentTerms ?? null,
      default_payment_terms_days: p.data.defaultPaymentTermsDays ?? null,
      notes: p.data.notes ?? null,
      created_by: g.userId,
      updated_by: g.userId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: friendly(error.message, error.code) };
  touch("/customers");
  return { ok: true, id: data.id };
}

export async function addCustomerDivision(input: unknown): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const p = parse(customerDivisionSchema, input);
  if (!p.ok) return p;
  const supabase = await createClient();
  const { error } = await supabase.from("customer_division").insert({
    customer_id: p.data.customerId,
    name: p.data.name,
    notes: p.data.notes ?? null,
  });
  if (error) return { ok: false, error: friendly(error.message, error.code) };
  touch(`/customers/${p.data.customerId}`, "/customers");
  return { ok: true };
}

export async function addCustomerLocation(input: unknown): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const p = parse(customerLocationSchema, input);
  if (!p.ok) return p;
  const supabase = await createClient();
  const { error } = await supabase.from("customer_location").insert({
    customer_id: p.data.customerId,
    division_id: p.data.divisionId ?? null,
    label: p.data.label ?? null,
    address_type: p.data.addressType,
    address_line1: p.data.addressLine1 ?? null,
    address_line2: p.data.addressLine2 ?? null,
    city: p.data.city ?? null,
    state: p.data.state ?? null,
    postal_code: p.data.postalCode ?? null,
    country: p.data.country,
    gstin: p.data.gstin ?? null,
    is_default: p.data.isDefault,
  });
  if (error) return { ok: false, error: friendly(error.message, error.code) };
  touch(`/customers/${p.data.customerId}`);
  return { ok: true };
}

export async function addCustomerContact(input: unknown): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const p = parse(customerContactSchema, input);
  if (!p.ok) return p;
  const supabase = await createClient();
  const { error } = await supabase.from("customer_contact").insert({
    customer_id: p.data.customerId,
    division_id: p.data.divisionId ?? null,
    location_id: p.data.locationId ?? null,
    full_name: p.data.fullName,
    designation: p.data.designation ?? null,
    role: p.data.role ?? null,
    email: p.data.email || null,
    phone_e164: p.data.phoneE164 || null,
    is_primary: p.data.isPrimary,
  });
  if (error) return { ok: false, error: friendly(error.message, error.code) };
  touch(`/customers/${p.data.customerId}`);
  return { ok: true };
}

export async function addTaxRegistration(input: unknown): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const p = parse(taxRegistrationSchema, input);
  if (!p.ok) return p;
  const supabase = await createClient();
  const { error } = await supabase.from("tax_registration").insert({
    customer_id: p.data.customerId,
    registration_type: p.data.registrationType,
    value_encrypted: encryptField(p.data.value),
    value_last4: last4(p.data.value),
    valid_from: p.data.validFrom ?? null,
    valid_to: p.data.validTo ?? null,
    notes: p.data.notes ?? null,
  });
  if (error) return { ok: false, error: friendly(error.message, error.code) };
  touch(`/customers/${p.data.customerId}`);
  return { ok: true };
}

export async function addPortalReference(input: unknown): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const p = parse(portalReferenceSchema, input);
  if (!p.ok) return p;
  const supabase = await createClient();
  const { error } = await supabase.from("portal_reference").insert({
    customer_id: p.data.customerId,
    portal_name: p.data.portalName,
    portal_url: p.data.portalUrl ?? null,
    responsible_user_id: p.data.responsibleUserId ?? null,
    notes: p.data.notes ?? null,
  });
  if (error) return { ok: false, error: friendly(error.message, error.code) };
  touch(`/customers/${p.data.customerId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Product
// ---------------------------------------------------------------------------
export async function createProduct(input: unknown): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const p = parse(productSchema, input);
  if (!p.ok) return p;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product")
    .insert({
      internal_part_number: p.data.internalPartNumber,
      description: p.data.description,
      category: p.data.category ?? null,
      uom: p.data.uom,
      hsn_code: p.data.hsnCode || null,
      technical_specs: p.data.technicalSpecs ?? null,
      moq: p.data.moq ?? null,
      lead_time_days: p.data.leadTimeDays ?? null,
      shelf_life_days: p.data.shelfLifeDays ?? null,
      warranty_text: p.data.warrantyText ?? null,
      country_of_origin: p.data.countryOfOrigin ?? null,
      export_restricted: p.data.exportRestricted,
      standard_price: p.data.standardPrice ?? null,
      currency: p.data.currency,
      created_by: g.userId,
      updated_by: g.userId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: friendly(error.message, error.code) };
  touch("/products");
  return { ok: true, id: data.id };
}

export async function addPartNumber(input: unknown): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const p = parse(partNumberSchema, input);
  if (!p.ok) return p;
  const supabase = await createClient();
  const { error } = await supabase.from("part_number").insert({
    product_id: p.data.productId,
    part_number_type: p.data.partNumberType,
    customer_id: p.data.customerId ?? null,
    partner_id: p.data.partnerId ?? null,
    value: p.data.value,
  });
  if (error) return { ok: false, error: friendly(error.message, error.code) };
  touch(`/products/${p.data.productId}`);
  return { ok: true };
}

export async function addApprovalRequirement(
  input: unknown,
): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const p = parse(approvalRequirementSchema, input);
  if (!p.ok) return p;
  const supabase = await createClient();
  const { error } = await supabase.from("product_approval_requirement").insert({
    product_id: p.data.productId,
    approval_type: p.data.approvalType,
    is_required: p.data.isRequired,
    notes: p.data.notes ?? null,
  });
  if (error) return { ok: false, error: friendly(error.message, error.code) };
  touch(`/products/${p.data.productId}`);
  return { ok: true };
}

export async function addApprovalCertificate(
  input: unknown,
): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const p = parse(approvalCertificateSchema, input);
  if (!p.ok) return p;
  const supabase = await createClient();
  const { error } = await supabase.from("product_approval_certificate").insert({
    product_id: p.data.productId,
    approval_type: p.data.approvalType,
    certificate_number: p.data.certificateNumber ?? null,
    issued_by: p.data.issuedBy ?? null,
    valid_from: p.data.validFrom ?? null,
    valid_to: p.data.validTo ?? null,
    document_reference: p.data.documentReference ?? null,
  });
  if (error) return { ok: false, error: friendly(error.message, error.code) };
  touch(`/products/${p.data.productId}`);
  return { ok: true };
}

export async function addProductPrice(input: unknown): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const p = parse(productPriceSchema, input);
  if (!p.ok) return p;
  const supabase = await createClient();
  const { error } = await supabase.from("product_price").insert({
    product_id: p.data.productId,
    partner_id: p.data.partnerId ?? null,
    price_type: p.data.priceType,
    amount: p.data.amount,
    currency: p.data.currency,
    valid_from: p.data.validFrom ?? null,
    valid_to: p.data.validTo ?? null,
    source: p.data.source ?? null,
    notes: p.data.notes ?? null,
    created_by: g.userId,
  });
  if (error) return { ok: false, error: friendly(error.message, error.code) };
  touch(`/products/${p.data.productId}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Partner
// ---------------------------------------------------------------------------
export async function createPartner(input: unknown): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const p = parse(partnerSchema, input);
  if (!p.ok) return p;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("partner")
    .insert({
      name: p.data.name,
      legal_name: p.data.legalName ?? null,
      country: p.data.country,
      vendor_code: p.data.vendorCode ?? null,
      is_defence_qualified: p.data.isDefenceQualified,
      qualification_notes: p.data.qualificationNotes ?? null,
      notes: p.data.notes ?? null,
      created_by: g.userId,
      updated_by: g.userId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: friendly(error.message, error.code) };

  const { error: typeError } = await supabase.from("partner_type_link").insert(
    p.data.types.map((type) => ({ partner_id: data.id, partner_type: type })),
  );
  if (typeError) {
    return { ok: false, error: friendly(typeError.message, typeError.code) };
  }
  touch("/oems");
  return { ok: true, id: data.id };
}

export async function addPartnerLocation(input: unknown): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const p = parse(partnerLocationSchema, input);
  if (!p.ok) return p;
  const supabase = await createClient();
  const { error } = await supabase.from("partner_location").insert({
    partner_id: p.data.partnerId,
    label: p.data.label ?? null,
    address_type: p.data.addressType,
    address_line1: p.data.addressLine1 ?? null,
    address_line2: p.data.addressLine2 ?? null,
    city: p.data.city ?? null,
    state: p.data.state ?? null,
    postal_code: p.data.postalCode ?? null,
    country: p.data.country,
    gstin: p.data.gstin ?? null,
    is_default: p.data.isDefault,
  });
  if (error) return { ok: false, error: friendly(error.message, error.code) };
  touch(`/oems/${p.data.partnerId}`);
  return { ok: true };
}

export async function addPartnerContact(input: unknown): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const p = parse(partnerContactSchema, input);
  if (!p.ok) return p;
  const supabase = await createClient();
  const { error } = await supabase.from("partner_contact").insert({
    partner_id: p.data.partnerId,
    location_id: p.data.locationId ?? null,
    full_name: p.data.fullName,
    designation: p.data.designation ?? null,
    role: p.data.role ?? null,
    email: p.data.email || null,
    phone_e164: p.data.phoneE164 || null,
    is_primary: p.data.isPrimary,
  });
  if (error) return { ok: false, error: friendly(error.message, error.code) };
  touch(`/oems/${p.data.partnerId}`);
  return { ok: true };
}

export async function addPartnerCapability(
  input: unknown,
): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const p = parse(partnerCapabilitySchema, input);
  if (!p.ok) return p;
  const supabase = await createClient();
  const { error } = await supabase.from("partner_capability").insert({
    partner_id: p.data.partnerId,
    capability: p.data.capability,
    notes: p.data.notes ?? null,
  });
  if (error) return { ok: false, error: friendly(error.message, error.code) };
  touch(`/oems/${p.data.partnerId}`);
  return { ok: true };
}

export async function addBankAccount(input: unknown): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const p = parse(bankAccountSchema, input);
  if (!p.ok) return p;
  const supabase = await createClient();
  const { error } = await supabase.from("partner_bank_account").insert({
    partner_id: p.data.partnerId,
    account_name_encrypted: encryptField(p.data.accountName),
    account_number_encrypted: encryptField(p.data.accountNumber),
    account_number_last4: last4(p.data.accountNumber),
    ifsc_encrypted: encryptField(p.data.ifsc),
    ifsc_last4: last4(p.data.ifsc),
    bank_name: p.data.bankName ?? null,
    branch: p.data.branch ?? null,
    swift_encrypted: p.data.swift ? encryptField(p.data.swift) : null,
    swift_last4: p.data.swift ? last4(p.data.swift) : null,
    created_by: g.userId,
  });
  if (error) return { ok: false, error: friendly(error.message, error.code) };
  touch(`/oems/${p.data.partnerId}`);
  return { ok: true };
}

export async function addCommissionAgreement(
  input: unknown,
): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (!user.roles.some((role) => ["owner", "finance", "admin"].includes(role))) {
    return { ok: false, error: "Only Owner, Finance or Admin can manage agreements." };
  }
  const p = parse(commissionAgreementSchema, input);
  if (!p.ok) return p;
  const supabase = await createClient();
  const { error } = await supabase.from("commission_agreement").insert({
    partner_id: p.data.partnerId,
    commission_percent: p.data.commissionPercent,
    effective_from: p.data.effectiveFrom,
    effective_to: p.data.effectiveTo ?? null,
    pricing_validity_days: p.data.pricingValidityDays ?? null,
    freight_terms: p.data.freightTerms ?? null,
    warranty_terms: p.data.warrantyTerms ?? null,
    moq_rule: p.data.moqRule ?? null,
    nda_status: p.data.ndaStatus ?? null,
    notes: p.data.notes ?? null,
    approved_by: user.id,
    approved_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: friendly(error.message, error.code) };
  touch(`/oems/${p.data.partnerId}`);
  return { ok: true };
}

export async function linkPartnerProduct(
  input: unknown,
): Promise<ActionResult> {
  const g = await guard();
  if (!g.ok) return g;
  const p = parse(partnerProductSchema, input);
  if (!p.ok) return p;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_partner_product", {
    p_partner_id: p.data.partnerId,
    p_product_id: p.data.productId,
    p_relationship_type: p.data.relationshipType,
    p_exclusive_representation: p.data.exclusiveRepresentation,
    p_lead_time_days: p.data.leadTimeDays ?? null,
    p_moq: p.data.moq ?? null,
    p_approved_source: p.data.approvedSource,
    p_approved_evidence: p.data.approvedEvidence ?? null,
    p_notes: p.data.notes ?? null,
    p_override: p.data.override,
    p_reason: p.data.reason ?? null,
  });
  if (error) return { ok: false, error: friendly(error.message, error.code) };
  touch(`/oems/${p.data.partnerId}`, `/products/${p.data.productId}`);
  return { ok: true, id: data as string };
}
