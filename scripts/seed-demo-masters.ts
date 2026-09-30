/**
 * Seed synthetic Phase 1 master data (customers, partners, products).
 *
 *   npm run seed:masters
 *
 * Synthetic data only. Idempotent: safe to run repeatedly.
 * Requires NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
 * FIELD_ENCRYPTION_KEY.
 *
 * Creates its own Supabase client (see scripts/seed-demo-users.ts for why).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { encryptField, last4 } from "../src/lib/crypto";

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(file);
    } catch {
      // Missing file — fall back to the real environment.
    }
  }
}

async function getOrCreateId(
  supabase: SupabaseClient,
  table: string,
  match: Record<string, string>,
  insert: Record<string, unknown>,
): Promise<string> {
  let query = supabase.from(table).select("id");
  for (const [key, value] of Object.entries(match)) {
    query = query.eq(key, value);
  }
  const { data: found } = await query.limit(1).maybeSingle();
  if (found) return found.id as string;

  const { data, error } = await supabase
    .from(table)
    .insert(insert)
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`Failed to create ${table}: ${error?.message}`);
  }
  return data.id as string;
}

async function main() {
  loadEnv();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
  }
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // --- Customers -----------------------------------------------------------
  const ordnanceId = await getOrCreateId(
    supabase,
    "customer",
    { name: "Demo Ordnance Directorate" },
    {
      name: "Demo Ordnance Directorate",
      legal_name: "Demo Ordnance Directorate (fictional)",
      customer_type: "government",
      default_payment_terms: "30 days from acceptance",
      default_payment_terms_days: 30,
    },
  );
  const navalId = await getOrCreateId(
    supabase,
    "customer",
    { name: "Demo Naval Systems Command" },
    {
      name: "Demo Naval Systems Command",
      customer_type: "defence_agency",
      default_payment_terms_days: 45,
    },
  );
  const aerospaceId = await getOrCreateId(
    supabase,
    "customer",
    { name: "Demo Aerospace Depot" },
    { name: "Demo Aerospace Depot", customer_type: "psu" },
  );

  await getOrCreateId(
    supabase,
    "customer_division",
    { customer_id: ordnanceId, name: "Demo Weapons Division" },
    { customer_id: ordnanceId, name: "Demo Weapons Division" },
  );
  await getOrCreateId(
    supabase,
    "customer_division",
    { customer_id: navalId, name: "Demo Marine Division" },
    { customer_id: navalId, name: "Demo Marine Division" },
  );

  await getOrCreateId(
    supabase,
    "customer_location",
    { customer_id: ordnanceId, city: "New Delhi", address_type: "billing" },
    {
      customer_id: ordnanceId,
      address_type: "billing",
      label: "Head office",
      city: "New Delhi",
      state: "Delhi",
      postal_code: "110001",
      is_default: true,
    },
  );
  await getOrCreateId(
    supabase,
    "customer_location",
    { customer_id: ordnanceId, city: "Pune", address_type: "delivery" },
    {
      customer_id: ordnanceId,
      address_type: "delivery",
      label: "Delivery depot",
      city: "Pune",
      state: "Maharashtra",
    },
  );

  await getOrCreateId(
    supabase,
    "customer_contact",
    { customer_id: ordnanceId, full_name: "Demo Purchase Officer" },
    {
      customer_id: ordnanceId,
      full_name: "Demo Purchase Officer",
      designation: "Assistant Director",
      role: "purchase",
      email: "purchase.officer@demo.local",
      phone_e164: "+919800000001",
      is_primary: true,
    },
  );

  // Tax registration (encrypted at rest).
  const existingTax = await supabase
    .from("tax_registration")
    .select("id")
    .eq("customer_id", ordnanceId)
    .eq("registration_type", "GSTIN")
    .maybeSingle();
  if (!existingTax.data) {
    const gstin = "27AAAAA0000A1Z5";
    const { error } = await supabase.from("tax_registration").insert({
      customer_id: ordnanceId,
      registration_type: "GSTIN",
      value_encrypted: encryptField(gstin),
      value_last4: last4(gstin),
      valid_from: "2024-04-01",
      valid_to: "2029-03-31",
    });
    if (error) throw new Error(`tax_registration: ${error.message}`);
  }

  await getOrCreateId(
    supabase,
    "portal_reference",
    { customer_id: ordnanceId, portal_name: "GeM" },
    {
      customer_id: ordnanceId,
      portal_name: "GeM",
      portal_url: "https://gem.gov.in",
      notes: "Reference only. No credentials stored.",
    },
  );

  // --- Partners ------------------------------------------------------------
  const oemId = await getOrCreateId(
    supabase,
    "partner",
    { name: "Demo Defence OEM Pvt Ltd" },
    {
      name: "Demo Defence OEM Pvt Ltd",
      legal_name: "Demo Defence OEM Pvt Ltd (fictional)",
      country: "India",
      vendor_code: "DEMO-VEN-001",
      is_defence_qualified: true,
      qualification_notes: "Synthetic ISO 9001 evidence on file.",
    },
  );
  const supplierId = await getOrCreateId(
    supabase,
    "partner",
    { name: "Demo Components Supplier Ltd" },
    {
      name: "Demo Components Supplier Ltd",
      country: "India",
      vendor_code: "DEMO-VEN-002",
    },
  );

  for (const [partnerId, types] of [
    [oemId, ["oem", "manufacturer"]],
    [supplierId, ["supplier"]],
  ] as const) {
    for (const partnerType of types) {
      const existing = await supabase
        .from("partner_type_link")
        .select("partner_id")
        .eq("partner_id", partnerId)
        .eq("partner_type", partnerType)
        .maybeSingle();
      if (!existing.data) {
        await supabase
          .from("partner_type_link")
          .insert({ partner_id: partnerId, partner_type: partnerType });
      }
    }
  }

  // One OEM with three locations.
  for (const [city, label, state] of [
    ["Pune", "Unit 1", "Maharashtra"],
    ["Nashik", "Unit 2", "Maharashtra"],
    ["Hyderabad", "Unit 3", "Telangana"],
  ] as const) {
    await getOrCreateId(
      supabase,
      "partner_location",
      { partner_id: oemId, city },
      {
        partner_id: oemId,
        label,
        address_type: "correspondence",
        city,
        state,
      },
    );
  }

  await getOrCreateId(
    supabase,
    "partner_contact",
    { partner_id: oemId, full_name: "Demo OEM Sales Manager" },
    {
      partner_id: oemId,
      full_name: "Demo OEM Sales Manager",
      designation: "Key Account Manager",
      role: "purchase",
      email: "sales.manager@demo.local",
      phone_e164: "+919800000002",
      is_primary: true,
    },
  );

  await getOrCreateId(
    supabase,
    "partner_capability",
    { partner_id: oemId, capability: "Precision machined components" },
    { partner_id: oemId, capability: "Precision machined components" },
  );

  // Commission agreement.
  const existingAgreement = await supabase
    .from("commission_agreement")
    .select("id")
    .eq("partner_id", oemId)
    .eq("effective_from", "2026-01-01")
    .maybeSingle();
  if (!existingAgreement.data) {
    const { error } = await supabase.from("commission_agreement").insert({
      partner_id: oemId,
      commission_percent: 8,
      effective_from: "2026-01-01",
      pricing_validity_days: 30,
      freight_terms: "Ex-works",
      warranty_terms: "12 months",
      nda_status: "Signed",
    });
    if (error) throw new Error(`commission_agreement: ${error.message}`);
  }

  // Bank details (encrypted).
  const existingBank = await supabase
    .from("partner_bank_account")
    .select("id")
    .eq("partner_id", oemId)
    .maybeSingle();
  if (!existingBank.data) {
    const accountNumber = "000123456789";
    const ifsc = "DEMO0001234";
    const { error } = await supabase.from("partner_bank_account").insert({
      partner_id: oemId,
      account_name_encrypted: encryptField("Demo Defence OEM Pvt Ltd"),
      account_number_encrypted: encryptField(accountNumber),
      account_number_last4: last4(accountNumber),
      ifsc_encrypted: encryptField(ifsc),
      ifsc_last4: last4(ifsc),
      bank_name: "Demo Bank",
      branch: "Pune Main",
    });
    if (error) throw new Error(`partner_bank_account: ${error.message}`);
  }

  // --- Products ------------------------------------------------------------
  const products = [
    {
      internal_part_number: "DC-PWR-0001",
      description: "Demo Power Supply Unit 24V 10A",
      category: "Power",
      uom: "EA",
      standard_price: 18500,
      moq: 5,
      lead_time_days: 45,
      hsn_code: "8504",
    },
    {
      internal_part_number: "DC-CBL-0002",
      description: "Demo Armoured Cable 50m",
      category: "Cabling",
      uom: "ROLL",
      standard_price: 9800,
      lead_time_days: 30,
    },
    {
      internal_part_number: "DC-CNN-0003",
      description: "Demo Circular Connector MIL-DTL",
      category: "Connectors",
      uom: "EA",
      standard_price: 3200,
    },
    {
      internal_part_number: "DC-BAT-0004",
      description: "Demo Battery Pack 12V",
      category: "Power",
      uom: "EA",
      standard_price: 7400,
      export_restricted: true,
    },
  ];
  const productIds: Record<string, string> = {};
  for (const product of products) {
    productIds[product.internal_part_number] = await getOrCreateId(
      supabase,
      "product",
      { internal_part_number: product.internal_part_number },
      product,
    );
  }
  const pwrId = productIds["DC-PWR-0001"];
  const cblId = productIds["DC-CBL-0002"];

  // Part numbers.
  await getOrCreateId(
    supabase,
    "part_number",
    { product_id: pwrId, part_number_type: "customer", value: "CUST-PWR-101" },
    {
      product_id: pwrId,
      part_number_type: "customer",
      customer_id: ordnanceId,
      value: "CUST-PWR-101",
    },
  );
  await getOrCreateId(
    supabase,
    "part_number",
    { product_id: pwrId, part_number_type: "oem", value: "OEM-PWR-9001" },
    {
      product_id: pwrId,
      part_number_type: "oem",
      partner_id: oemId,
      value: "OEM-PWR-9001",
    },
  );

  // Approval requirement with an expired certificate.
  await getOrCreateId(
    supabase,
    "product_approval_requirement",
    { product_id: pwrId, approval_type: "dgqa" },
    { product_id: pwrId, approval_type: "dgqa", is_required: true },
  );
  const existingCert = await supabase
    .from("product_approval_certificate")
    .select("id")
    .eq("product_id", pwrId)
    .eq("approval_type", "dgqa")
    .maybeSingle();
  if (!existingCert.data) {
    const { error } = await supabase.from("product_approval_certificate").insert({
      product_id: pwrId,
      approval_type: "dgqa",
      certificate_number: "DEMO-DGQA-0001",
      issued_by: "DGQA (fictional)",
      valid_from: "2023-01-01",
      valid_to: "2024-01-01",
    });
    if (error) throw new Error(`approval_certificate: ${error.message}`);
  }

  // Prices.
  for (const [priceType, amount] of [
    ["oem_cost", 15000],
    ["quoted", 18500],
  ] as const) {
    const existing = await supabase
      .from("product_price")
      .select("id")
      .eq("product_id", pwrId)
      .eq("price_type", priceType)
      .maybeSingle();
    if (!existing.data) {
      await supabase.from("product_price").insert({
        product_id: pwrId,
        partner_id: priceType === "oem_cost" ? oemId : null,
        price_type: priceType,
        amount,
        valid_from: "2026-01-01",
        source: "Synthetic seed",
      });
    }
  }

  // Partner–product links (one exclusive represented OEM).
  // Inserted directly with the service role: the RPC requires auth.uid(), which
  // a service-role key does not carry. The exclusivity trigger still applies.
  await getOrCreateId(
    supabase,
    "partner_product",
    {
      partner_id: oemId,
      product_id: pwrId,
      relationship_type: "represented_oem",
    },
    {
      partner_id: oemId,
      product_id: pwrId,
      relationship_type: "represented_oem",
      exclusive_representation: true,
      lead_time_days: 45,
      moq: 5,
      approved_source: true,
      approved_evidence: "Synthetic approved-source letter",
      notes: "Exclusive representation (demo)",
    },
  );
  await getOrCreateId(
    supabase,
    "partner_product",
    {
      partner_id: oemId,
      product_id: cblId,
      relationship_type: "represented_oem",
    },
    {
      partner_id: oemId,
      product_id: cblId,
      relationship_type: "represented_oem",
      exclusive_representation: false,
      lead_time_days: 30,
      moq: 10,
      notes: "Alternate represented OEM (demo)",
    },
  );

  console.log("Done. Synthetic master data ready (customers, partners, products).");
  console.log(
    `Customers: 3 · Partners: 2 · Products: ${products.length} (synthetic only).`,
  );
  void aerospaceId;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
