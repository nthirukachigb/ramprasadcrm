/**
 * Phase 7 acceptance verification (T7.1 PO, T7.3 mismatch, T7.4 amendment,
 * T7.5 supplier PO, T7.6 tile) against a live Supabase project.
 *
 *   npm run verify:phase7
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

  const customer = await admin.from("customer").select("id").limit(1).maybeSingle();
  const partner = await admin.from("partner").select("id").limit(1).maybeSingle();
  if (!customer.data || !partner.data) throw new Error("Seed masters first.");

  const { data: req } = await admin
    .from("requirement")
    .insert({
      requirement_type: "enquiry",
      customer_id: customer.data.id,
      source_channel: "email",
      customer_reference: `E2E-P7-${Date.now()}`,
      enquiry_date: today(),
    })
    .select("id")
    .single();
  const { data: line } = await admin
    .from("requirement_line")
    .insert({
      requirement_id: req!.id,
      line_no: 1,
      description: "E2E P7 line",
      internal_part_no: `E2E-P7-${Date.now()}`,
      quantity_required: 1000,
      uom: "NO",
    })
    .select("id")
    .single();

  const { data: quotation } = await admin
    .from("quotation")
    .insert({ requirement_id: req!.id })
    .select("id")
    .single();
  const { data: vApproved } = await admin
    .from("quotation_version")
    .insert({
      quotation_id: quotation!.id,
      version_no: 1,
      status: "draft",
      payment_terms: "45 days",
      delivery_terms: "Ex-works",
    })
    .select("id")
    .single();
  await admin.from("quotation_line").insert({
    quotation_version_id: vApproved!.id,
    requirement_line_id: line!.id,
    qty_quoted: 1000,
    uom: "NO",
    unit_cost: 60,
    proposed_unit_price: 100,
    sourcing_basis: "in_house",
  });
  await admin
    .from("quotation_version")
    .update({ status: "approved", approved_at: new Date().toISOString() })
    .eq("id", vApproved!.id);
  await admin
    .from("quotation")
    .update({ current_version_id: vApproved!.id })
    .eq("id", quotation!.id);
  const { data: vDraft } = await admin
    .from("quotation_version")
    .insert({ quotation_id: quotation!.id, version_no: 2, status: "draft" })
    .select("id")
    .single();

  // T7.1 · PO on a draft version fails --------------------------------------
  const draftPo = await owner.from("customer_po").insert({
    quotation_version_id: vDraft!.id,
    customer_id: customer.data.id,
    customer_po_number: `DRAFT-${Date.now()}`,
  });
  record(
    "T7.1 A PO on a draft version fails with BR-02",
    Boolean(draftPo.error) && /BR-02/.test(draftPo.error?.message ?? ""),
    draftPo.error?.message.split("\n")[0] ?? "draft PO allowed",
  );

  const { data: po } = await owner
    .from("customer_po")
    .insert({
      quotation_version_id: vApproved!.id,
      customer_id: customer.data.id,
      customer_po_number: `PO-${Date.now()}`,
      payment_terms: "60 days",
      delivery_terms: "Ex-works",
    })
    .select("id, internal_ref")
    .single();
  record(
    "T7.1 A PO on an approved version is accepted and numbered",
    /^PO\/\d{2}-\d{2}\/\d{4}$/.test(po?.internal_ref ?? ""),
    po?.internal_ref ?? "none",
  );

  // T7.1 · Delivery schedule sum (deferred constraint) ----------------------
  const { data: poline } = await owner
    .from("po_line")
    .insert({
      customer_po_id: po!.id,
      quotation_line_id: (
        await admin.from("quotation_line").select("id").eq("quotation_version_id", vApproved!.id).single()
      ).data!.id,
      requirement_line_id: line!.id,
      qty_ordered: 900,
      qty_ordered_effective: 900,
      unit_rate: 90,
      uom: "NO",
    })
    .select("id")
    .single();

  const scheduleOk = await owner.from("po_delivery_schedule").insert([
    { po_line_id: poline!.id, sequence: 1, qty: 300, due_date: "2027-02-01" },
    { po_line_id: poline!.id, sequence: 2, qty: 300, due_date: "2027-03-01" },
    { po_line_id: poline!.id, sequence: 3, qty: 300, due_date: "2027-04-01" },
  ]);
  const scheduleBad = await owner
    .from("po_delivery_schedule")
    .insert({ po_line_id: poline!.id, sequence: 4, qty: 100, due_date: "2027-05-01" });
  record(
    "T7.1 Staggered deliveries summing to the line quantity are allowed; a bad sum is rejected",
    !scheduleOk.error &&
      Boolean(scheduleBad.error) &&
      /FR-PO-06/.test(scheduleBad.error?.message ?? ""),
    scheduleBad.error?.message.split("\n")[0] ?? "bad sum allowed",
  );

  // T7.3 · Mismatch flagged and acknowledgement blocked ---------------------
  const mismatches = await admin
    .from("po_mismatch")
    .select("id, field, severity, resolution")
    .eq("customer_po_id", po!.id);
  const rateMismatch = (mismatches.data ?? []).find((m) => m.field === "unit_rate");
  const termMismatch = (mismatches.data ?? []).find((m) => m.field === "payment_terms");
  record(
    "T7.3 Quoted 100 vs PO 90 is flagged, and 45 vs 60 day terms are flagged",
    Boolean(rateMismatch) && rateMismatch?.severity === "high" && Boolean(termMismatch),
    `rate ${rateMismatch?.severity ?? "none"}, terms ${termMismatch ? "flagged" : "not flagged"}`,
  );

  await owner.rpc("transition_customer_po", { p_id: po!.id, p_to_status: "under_review", p_reason: "review" });
  const ackBlocked = await owner.rpc("transition_customer_po", {
    p_id: po!.id,
    p_to_status: "acknowledged",
    p_reason: "try",
  });
  record(
    "T7.3 Acknowledgement is blocked while mismatches are unresolved",
    Boolean(ackBlocked.error) && /FR-PO-04/.test(ackBlocked.error?.message ?? ""),
    ackBlocked.error?.message.split("\n")[0] ?? "acknowledged despite mismatches",
  );

  // Accept each mismatch and approve its request, then acknowledge.
  for (const m of mismatches.data ?? []) {
    const { data: full } = await admin
      .from("po_mismatch")
      .select("id, approval_id")
      .eq("id", m.id)
      .single();
    if (full?.approval_id) {
      await owner.rpc("decide_approval", {
        p_approval_id: full.approval_id,
        p_decision: "approved",
        p_comment: "Owner accepts the variance (E2E)",
      });
    }
    await owner
      .from("po_mismatch")
      .update({ resolution: "accepted", reason: "Owner accepted" })
      .eq("id", m.id);
  }
  const ackOk = await owner.rpc("transition_customer_po", {
    p_id: po!.id,
    p_to_status: "acknowledged",
    p_reason: "all accepted",
  });
  record(
    "T7.3 Acknowledgement succeeds once mismatches are accepted and approved",
    !ackOk.error,
    ackOk.error?.message ?? "ok",
  );

  // T7.4 · Amendment keeps original and amended values ----------------------
  const { data: amendment } = await owner
    .from("po_amendment")
    .insert({ customer_po_id: po!.id, amendment_no: 1, reason: "Customer reduced quantity" })
    .select("id")
    .single();
  await owner.from("po_amendment_change").insert({
    po_amendment_id: amendment!.id,
    po_line_id: poline!.id,
    field: "qty",
    old_value: "900",
    new_value: "800",
  });
  const applyAmend = await owner.rpc("apply_po_amendment", { p_amendment_id: amendment!.id });
  const amendedLine = await admin
    .from("po_line")
    .select("qty_ordered, qty_ordered_effective")
    .eq("id", poline!.id)
    .single();
  const changes = await admin
    .from("po_amendment_change")
    .select("old_value, new_value")
    .eq("po_amendment_id", amendment!.id);
  record(
    "T7.4 Applying an amendment updates the effective quantity and keeps old/new values",
    !applyAmend.error &&
      Number(amendedLine.data?.qty_ordered_effective) === 800 &&
      Number(amendedLine.data?.qty_ordered) === 900 &&
      changes.data?.[0]?.old_value === "900" &&
      changes.data?.[0]?.new_value === "800",
    applyAmend.error?.message ?? `effective ${amendedLine.data?.qty_ordered_effective}`,
  );

  // T7.5 · Supplier PO line resolves to one requirement line ----------------
  const { data: spo } = await owner
    .from("supplier_po")
    .insert({ customer_po_id: po!.id, partner_id: partner.data.id })
    .select("id, internal_ref")
    .single();

  const spoNoSel = await owner
    .from("supplier_po_line")
    .insert({ supplier_po_id: spo!.id, po_line_id: poline!.id, qty: 100, unit_cost: 60 });
  record(
    "T7.5 A supplier PO line without the approved OEM selection is rejected",
    Boolean(spoNoSel.error) && /FR-SPO-01/.test(spoNoSel.error?.message ?? ""),
    spoNoSel.error?.message.split("\n")[0] ?? "allowed without a selection",
  );

  // Create an approved OEM selection for this line and partner.
  await admin.from("quantity_commitment").insert({
    requirement_line_id: line!.id,
    partner_id: partner.data.id,
    qty_committed: 800,
    evidence_note: "E2E P7 commitment",
  });
  const { data: sel } = await admin
    .from("oem_selection")
    .insert({
      requirement_line_id: line!.id,
      partner_id: partner.data.id,
      qty_allocated: 800,
      status: "proposed",
    })
    .select("id")
    .single();
  const selApproval = await owner.rpc("request_approval", {
    p_subject_type: "oem_selection",
    p_subject_id: sel!.id,
    p_reason: "Select OEM for E2E P7",
  });
  await owner.rpc("decide_approval", {
    p_approval_id: selApproval.data as string,
    p_decision: "approved",
    p_comment: "Owner selected the OEM (E2E)",
  });
  await admin
    .from("oem_selection")
    .update({ status: "approved", approval_id: selApproval.data as string })
    .eq("id", sel!.id);

  const spoLine = await owner
    .from("supplier_po_line")
    .insert({ supplier_po_id: spo!.id, po_line_id: poline!.id, qty: 800, unit_cost: 62 })
    .select("requirement_line_id")
    .single();
  const coverage = await owner
    .from("v_po_line_coverage")
    .select("qty_ordered, qty_covered, qty_uncovered")
    .eq("po_line_id", poline!.id)
    .single();
  record(
    "T7.5 A supplier PO line resolves to one requirement line and coverage is calculated",
    !spoLine.error &&
      spoLine.data?.requirement_line_id === line!.id &&
      Number(coverage.data?.qty_covered) === 800 &&
      Number(coverage.data?.qty_uncovered) === 0,
    spoLine.error?.message ?? `covered ${coverage.data?.qty_covered}, uncovered ${coverage.data?.qty_uncovered}`,
  );

  // T7.6 · Tile D-05 count = drill-down rows --------------------------------
  const kpi = await owner
    .from("v_dashboard_kpis")
    .select("count_value")
    .eq("tile_code", "D-05")
    .maybeSingle();
  const tileRows = await owner.from("v_tile_d05").select("customer_po_id");
  record(
    "T7.6 Tile D-05 count equals its drill-down rows",
    (kpi.data?.count_value ?? -1) === (tileRows.data?.length ?? -2),
    `tile ${kpi.data?.count_value ?? "n/a"}, rows ${tileRows.data?.length ?? "n/a"}`,
  );

  // Cleanup -----------------------------------------------------------------
  await admin.from("requirement").delete().eq("id", req!.id);

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
