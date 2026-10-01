/**
 * Phase 5 acceptance verification (T5.1 quotation schema) against a live
 * Supabase project.
 *
 *   npm run verify:phase5
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

const results: { name: string; pass: boolean; detail: string }[] = [];
function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

const today = () => new Date().toISOString().slice(0, 10);

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const password = process.env.DEMO_USER_PASSWORD!;
  if (!url || !anon || !service || !password) throw new Error("Missing env.");

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
  const operations = await signIn("operations@demo.local");

  const customer = await admin.from("customer").select("id").limit(1).maybeSingle();
  if (!customer.data) throw new Error("Seed masters first.");

  async function newRequirement(suffix: string) {
    const { data } = await admin
      .from("requirement")
      .insert({
        requirement_type: "enquiry",
        customer_id: customer.data!.id,
        source_channel: "email",
        customer_reference: `E2E-P5-${suffix}-${Date.now()}`,
        enquiry_date: today(),
      })
      .select("id")
      .single();
    return data!.id as string;
  }
  async function newLine(requirementId: string, part: string) {
    const { data } = await admin
      .from("requirement_line")
      .insert({
        requirement_id: requirementId,
        line_no: 1,
        description: `E2E quote line ${part}`,
        internal_part_no: part,
        quantity_required: 1000,
        uom: "NO",
      })
      .select("id")
      .single();
    return data!.id as string;
  }

  const req1 = await newRequirement("A");
  const req2 = await newRequirement("B");
  const line1 = await newLine(req1, `E2E-P5-${Date.now()}`);
  const otherReqLine = await newLine(req2, `E2E-P5B-${Date.now()}`);

  // 1. A quotation without a requirement is rejected ------------------------
  const noRequirement = await owner.from("quotation").insert({ oem_quote_no: "X" });
  record(
    "T5.1 A quotation insert without a requirement fails",
    Boolean(noRequirement.error) && noRequirement.error?.code === "23502",
    noRequirement.error ? `code ${noRequirement.error.code}` : "inserted without requirement",
  );

  // 2. Automatic quotation numbering ----------------------------------------
  const { data: quotation } = await admin
    .from("quotation")
    .insert({ requirement_id: req1 })
    .select("id, internal_quote_no")
    .single();
  record(
    "T5.1 Quotation numbering generates a unique QT reference",
    /^QT\/\d{2}-\d{2}\/\d{4}$/.test(quotation!.internal_quote_no ?? ""),
    quotation?.internal_quote_no ?? "none",
  );

  const { data: version } = await admin
    .from("quotation_version")
    .insert({ quotation_id: quotation!.id, version_no: 1, status: "draft" })
    .select("id")
    .single();

  // 3. A line from another requirement is rejected ---------------------------
  const crossLine = await owner.from("quotation_line").insert({
    quotation_version_id: version!.id,
    requirement_line_id: otherReqLine,
    qty_quoted: 10,
    uom: "NO",
    proposed_unit_price: 100,
  });
  record(
    "T5.1 A quotation line from another requirement is rejected (BR-01)",
    Boolean(crossLine.error) && /BR-01/.test(crossLine.error?.message ?? ""),
    crossLine.error ? crossLine.error.message.split("\n")[0] : "cross-requirement line allowed",
  );

  // 4. Create a real line, then lock the version -----------------------------
  const { data: qline } = await admin
    .from("quotation_line")
    .insert({
      quotation_version_id: version!.id,
      requirement_line_id: line1,
      qty_quoted: 800,
      uom: "NO",
      unit_cost: 60,
      freight_unit: 5,
      other_cost_unit: 2,
      target_margin_pct: 20,
      proposed_unit_price: 100,
    })
    .select("id")
    .single();

  const totals = await owner
    .from("v_quotation_totals")
    .select("net_amount, cost_amount, gross_amount, margin_pct")
    .eq("quotation_version_id", version!.id)
    .single();
  record(
    "T5.1 Totals are calculated in the database",
    Number(totals.data?.net_amount) === 80000 &&
      Number(totals.data?.cost_amount) === 53600 &&
      Number(totals.data?.gross_amount) === 80000,
    `net ${totals.data?.net_amount}, cost ${totals.data?.cost_amount}, margin ${totals.data?.margin_pct}`,
  );

  await admin
    .from("quotation_version")
    .update({ status: "approved", approved_at: new Date().toISOString() })
    .eq("id", version!.id);
  await admin
    .from("quotation")
    .update({ current_version_id: version!.id })
    .eq("id", quotation!.id);

  // 5. Updating an approved line fails --------------------------------------
  const editLocked = await owner
    .from("quotation_line")
    .update({ proposed_unit_price: 90 })
    .eq("id", qline!.id);
  record(
    "T5.1 Updating an approved quotation line fails (BR-19)",
    Boolean(editLocked.error) && /BR-19/.test(editLocked.error?.message ?? ""),
    editLocked.error ? editLocked.error.message.split("\n")[0] : "locked line was edited",
  );

  // 6. Approved version feeds the coverage view -----------------------------
  const cov1 = await owner
    .from("v_requirement_line_coverage")
    .select("qty_quoted, qty_committed, qty_uncovered")
    .eq("requirement_line_id", line1)
    .single();
  record(
    "T5.1 Approved quotation sets qty_quoted on the coverage view",
    Number(cov1.data?.qty_quoted) === 800 && Number(cov1.data?.qty_uncovered) === 800,
    `quoted ${cov1.data?.qty_quoted}, uncovered ${cov1.data?.qty_uncovered}`,
  );

  const partner = await admin.from("partner").select("id").limit(1).maybeSingle();
  await admin.from("quantity_commitment").insert({
    requirement_line_id: line1,
    partner_id: partner.data!.id,
    qty_committed: 500,
    evidence_note: "E2E P5 commitment",
  });
  const cov2 = await owner
    .from("v_requirement_line_coverage")
    .select("qty_quoted, qty_uncovered")
    .eq("requirement_line_id", line1)
    .single();
  record(
    "T5.1 Uncovered = quoted - committed",
    Number(cov2.data?.qty_quoted) === 800 && Number(cov2.data?.qty_uncovered) === 300,
    `quoted ${cov2.data?.qty_quoted}, uncovered ${cov2.data?.qty_uncovered}`,
  );

  // 7. Operations cannot see margin -----------------------------------------
  const opsMargin = await operations
    .from("v_quotation_line_margin")
    .select("id, unit_cost, margin_pct")
    .eq("requirement_line_id", line1);
  const ownerMargin = await owner
    .from("v_quotation_line_margin")
    .select("id, unit_cost, margin_pct")
    .eq("requirement_line_id", line1);
  record(
    "T5.1 Operations cannot read margin columns (Owner can)",
    (opsMargin.data?.length ?? -1) === 0 && (ownerMargin.data?.length ?? 0) === 1,
    `ops rows ${opsMargin.data?.length ?? "err"}, owner rows ${ownerMargin.data?.length ?? "err"}`,
  );

  const opsLine = await operations
    .from("v_quotation_line_ops")
    .select("*")
    .eq("requirement_line_id", line1)
    .single();
  const opsKeys = Object.keys(opsLine.data ?? {});
  record(
    "T5.1 The operations line view exposes no cost or margin columns",
    opsKeys.length > 0 &&
      !opsKeys.some((k) => /cost|freight|margin/i.test(k)),
    `columns: ${opsKeys.join(", ") || "none"}`,
  );

  // Cleanup -----------------------------------------------------------------
  await admin.from("requirement").delete().eq("id", req1);
  await admin.from("requirement").delete().eq("id", req2);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
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
