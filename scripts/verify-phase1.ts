/**
 * Phase 1 acceptance verification against a live Supabase project.
 *
 *   npm run verify:phase1
 *
 * Requires the same env as the seed scripts, plus seeded demo users. Asserts
 * the Phase 1 acceptance criteria and prints a PASS/FAIL report. Exits non-zero
 * if any check fails.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(file);
    } catch {
      // ignore
    }
  }
}

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

const results: Check[] = [];
function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const password = process.env.DEMO_USER_PASSWORD!;
  if (!url || !anon || !service || !password) {
    throw new Error("Missing env. Run seed:users first and check .env.local.");
  }

  const admin = createClient(url, service, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  async function signIn(email: string): Promise<SupabaseClient> {
    const client = createClient(url, anon, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(`sign-in ${email}: ${error.message}`);
    return client;
  }

  const owner = await signIn("owner@demo.local");
  const sales = await signIn("sales@demo.local");
  const finance = await signIn("finance@demo.local");

  // 1. Duplicate customer rejected -----------------------------------------
  const dupName = `Verify Dup Customer ${Date.now()}`;
  const first = await admin
    .from("customer")
    .insert({ name: dupName })
    .select("id")
    .single();
  const second = await admin.from("customer").insert({ name: dupName });
  record(
    "Duplicate customer name rejected",
    Boolean(second.error) && second.error?.code === "23505",
    second.error ? `code ${second.error.code}` : "duplicate was allowed",
  );
  if (first.data) await admin.from("customer").delete().eq("id", first.data.id);

  // 2. portal_reference has no credential column ---------------------------
  const portal = await admin.from("portal_reference").select("*").limit(1);
  const portalKeys = Object.keys(portal.data?.[0] ?? {});
  const forbidden = /pass(word|wd)?|secret|credential|token|api[_-]?key/i;
  const hasCredentialColumn = portalKeys.some((key) => forbidden.test(key));
  record(
    "portal_reference has no credential column",
    !hasCredentialColumn,
    hasCredentialColumn
      ? `found: ${portalKeys.filter((k) => forbidden.test(k)).join(", ")}`
      : "no password/secret/token columns",
  );

  // 3. Tax registration stored as ciphertext -------------------------------
  const tax = await admin
    .from("tax_registration")
    .select("value_encrypted, value_last4")
    .limit(1)
    .maybeSingle();
  const taxOk =
    !!tax.data &&
    typeof tax.data.value_encrypted === "string" &&
    tax.data.value_encrypted.startsWith("v1:") &&
    typeof tax.data.value_last4 === "string" &&
    tax.data.value_last4.length > 0;
  record(
    "Tax registration stored as ciphertext",
    taxOk,
    taxOk
      ? `v1: payload, last4 present`
      : "no encrypted tax registration found",
  );

  // 4. One OEM with three locations is one row + three location rows --------
  const oem = await admin
    .from("partner")
    .select("id, name")
    .eq("name", "Demo Defence OEM Pvt Ltd")
    .maybeSingle();
  let oemLocCount = 0;
  if (oem.data) {
    const locs = await admin
      .from("partner_location")
      .select("id", { count: "exact", head: true })
      .eq("partner_id", oem.data.id);
    oemLocCount = locs.count ?? 0;
  }
  record(
    "One OEM with three locations",
    Boolean(oem.data) && oemLocCount === 3,
    `partner rows for that name: ${oem.data ? 1 : 0}, locations: ${oemLocCount}`,
  );

  // 5. Sales cannot read partner_bank_account ------------------------------
  const salesBank = await sales.from("partner_bank_account").select("id");
  const financeBank = await finance.from("partner_bank_account").select("id");
  record(
    "Sales cannot read partner bank details; Finance can",
    (salesBank.data?.length ?? 0) === 0 && (financeBank.data?.length ?? 0) > 0,
    `sales rows: ${salesBank.data?.length ?? 0}, finance rows: ${financeBank.data?.length ?? 0}`,
  );

  // 6. Overlapping commission agreement rejected ---------------------------
  if (oem.data) {
    const overlap = await owner.from("commission_agreement").insert({
      partner_id: oem.data.id,
      commission_percent: 9,
      effective_from: "2026-06-01",
      effective_to: "2026-12-31",
    });
    record(
      "Overlapping commission agreement rejected",
      Boolean(overlap.error) &&
        /OVERLAPPING_AGREEMENT/.test(overlap.error?.message ?? ""),
      overlap.error ? overlap.error.message.split("\n")[0] : "overlap allowed",
    );
  }

  // 7. Product without UoM rejected ----------------------------------------
  const noUom = await owner.from("product").insert({
    internal_part_number: `VERIFY-NO-UOM-${Date.now()}`,
    description: "Verify product without UoM",
  });
  record(
    "Product without UoM rejected",
    Boolean(noUom.error) &&
      (noUom.error?.code === "23502" ||
        /uom|null value/i.test(noUom.error?.message ?? "")),
    noUom.error ? `code ${noUom.error.code}` : "product saved without UoM",
  );

  // 8. Exclusive representation blocked until Owner overrides --------------
  const pwr = await admin
    .from("product")
    .select("id")
    .eq("internal_part_number", "DC-PWR-0001")
    .maybeSingle();
  const supplier = await admin
    .from("partner")
    .select("id")
    .eq("name", "Demo Components Supplier Ltd")
    .maybeSingle();
  if (pwr.data && supplier.data) {
    const blocked = await owner.rpc("create_partner_product", {
      p_partner_id: supplier.data.id,
      p_product_id: pwr.data.id,
      p_relationship_type: "represented_oem",
      p_exclusive_representation: false,
      p_lead_time_days: 20,
      p_moq: 1,
      p_approved_source: false,
      p_approved_evidence: null,
      p_notes: "verify",
      p_override: false,
      p_reason: null,
    });
    const allowed = await owner.rpc("create_partner_product", {
      p_partner_id: supplier.data.id,
      p_product_id: pwr.data.id,
      p_relationship_type: "represented_oem",
      p_exclusive_representation: false,
      p_lead_time_days: 20,
      p_moq: 1,
      p_approved_source: false,
      p_approved_evidence: null,
      p_notes: "verify override",
      p_override: true,
      p_reason: "Phase 1 verification override",
    });
    record(
      "Second represented OEM blocked until Owner override",
      Boolean(blocked.error) &&
        /EXCLUSIVITY_CONFLICT/.test(blocked.error?.message ?? "") &&
        !allowed.error,
      blocked.error
        ? `blocked (${blocked.error.message.includes("EXCLUSIVITY_CONFLICT") ? "exclusivity" : "other"}), override ${
            allowed.error ? "failed" : "succeeded"
          }`
        : "second OEM was allowed without override",
    );
    // Cleanup the override link via service role.
    await admin
      .from("partner_product")
      .delete()
      .eq("partner_id", supplier.data.id)
      .eq("product_id", pwr.data.id);
  }

  // 9. Durability: master data persists ------------------------------------
  const customerCount = await admin
    .from("customer")
    .select("id", { count: "exact", head: true });
  record(
    "Customer data persists (durability)",
    (customerCount.count ?? 0) >= 3,
    `${customerCount.count ?? 0} customers stored`,
  );

  // 10. Unauthenticated access blocked -------------------------------------
  const anonClient = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anonRead = await anonClient.from("customer").select("id");
  record(
    "Unauthenticated access blocked by RLS",
    (anonRead.data?.length ?? 0) === 0,
    `anonymous rows: ${anonRead.data?.length ?? 0}`,
  );

  const failed = results.filter((r) => !r.pass);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed.`,
  );
  if (failed.length > 0) {
    console.log("Failed checks:");
    for (const check of failed) console.log(`  - ${check.name}: ${check.detail}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
