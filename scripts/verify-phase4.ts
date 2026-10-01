/**
 * Phase 4 acceptance verification (T4.1 coverage + T4.2 override) against a
 * live Supabase project.
 *
 *   npm run verify:phase4
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

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

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
  if (!customer.data) throw new Error("Seed masters first.");

  const { data: partnerRows } = await admin
    .from("partner")
    .select("id, name")
    .order("name", { ascending: true })
    .limit(2);
  const partners = partnerRows ?? [];
  if (partners.length < 2) {
    const { data: extra } = await admin
      .from("partner")
      .insert({ name: `E2E Partner ${Date.now()}` })
      .select("id, name")
      .single();
    if (extra) partners.push(extra);
  }

  // Fixture -----------------------------------------------------------------
  const { data: req } = await admin
    .from("requirement")
    .insert({
      requirement_type: "enquiry",
      customer_id: customer.data.id,
      source_channel: "email",
      customer_reference: `E2E-P4-${Date.now()}`,
      enquiry_date: todayISO(),
    })
    .select("id")
    .single();
  if (!req) throw new Error("Could not create requirement");

  async function addLine(description: string) {
    const { data } = await admin
      .from("requirement_line")
      .insert({
        requirement_id: req!.id,
        line_no: Math.floor(Math.random() * 900000) + 1,
        description,
        quantity_required: 1000,
        uom: "NO",
      })
      .select("id")
      .single();
    return data!.id as string;
  }
  const lineA = await addLine("E2E coverage A");
  const lineB = await addLine("E2E coverage B");
  const lineC = await addLine("E2E coverage C");

  async function coverage(lineId: string) {
    const { data } = await owner
      .from("v_requirement_line_coverage")
      .select("qty_required, qty_indicated, qty_committed, qty_uncovered, has_approved_override")
      .eq("requirement_line_id", lineId)
      .single();
    return data!;
  }

  // T4.1 · 1,000 required, OEM A 600 + OEM B 400 firm → uncovered 0 ----------
  const cA = await admin
    .from("quantity_commitment")
    .insert({
      requirement_line_id: lineA,
      partner_id: partners[0].id,
      qty_committed: 600,
      evidence_note: "E2E OEM A confirmation",
    })
    .select("id")
    .single();
  await admin.from("quantity_commitment").insert({
    requirement_line_id: lineA,
    partner_id: partners[1].id,
    qty_committed: 400,
    evidence_note: "E2E OEM B confirmation",
  });
  const covered = await coverage(lineA);
  record(
    "T4.1 1,000 required, 600 + 400 firm → uncovered 0",
    Number(covered.qty_committed) === 1000 && Number(covered.qty_uncovered) === 0,
    `committed ${covered.qty_committed}, uncovered ${covered.qty_uncovered}`,
  );

  // T4.1 · Withdraw B → uncovered 400 ---------------------------------------
  const { data: commitmentB } = await admin
    .from("quantity_commitment")
    .select("id")
    .eq("requirement_line_id", lineA)
    .eq("partner_id", partners[1].id)
    .single();
  await owner.rpc("withdraw_commitment", {
    p_id: commitmentB!.id,
    p_reason: "E2E withdraw OEM B",
  });
  const afterWithdraw = await coverage(lineA);
  record(
    "T4.1 Withdrawing OEM B (400) → uncovered 400",
    Number(afterWithdraw.qty_committed) === 600 && Number(afterWithdraw.qty_uncovered) === 400,
    `committed ${afterWithdraw.qty_committed}, uncovered ${afterWithdraw.qty_uncovered}`,
  );

  // T4.1 · Indication 800 only → committed 0, uncovered 1,000 ---------------
  const { data: request } = await admin
    .from("sourcing_request")
    .insert({ requirement_id: req.id, partner_id: partners[0].id, status: "sent" })
    .select("id")
    .single();
  const { data: requestLine } = await admin
    .from("sourcing_request_line")
    .insert({ request_id: request!.id, requirement_line_id: lineB, qty_requested: 1000 })
    .select("id")
    .single();
  const { data: response } = await admin
    .from("oem_response")
    .insert({ request_id: request!.id, partner_id: partners[0].id, status: "received" })
    .select("id")
    .single();
  const { data: responseLine } = await admin
    .from("oem_response_line")
    .insert({ response_id: response!.id, sourcing_request_line_id: requestLine!.id })
    .select("id")
    .single();
  await admin.from("quantity_indication").insert({
    response_line_id: responseLine!.id,
    qty_available_indicated: 800,
  });
  const indicationOnly = await coverage(lineB);
  record(
    "T4.1 Indication 800 only → committed 0, uncovered 1,000",
    Number(indicationOnly.qty_indicated) === 800 &&
      Number(indicationOnly.qty_committed) === 0 &&
      Number(indicationOnly.qty_uncovered) === 1000,
    `indicated ${indicationOnly.qty_indicated}, committed ${indicationOnly.qty_committed}, uncovered ${indicationOnly.qty_uncovered}`,
  );

  // T4.1 · An expired commitment is excluded --------------------------------
  await admin.from("quantity_commitment").insert({
    requirement_line_id: lineC,
    partner_id: partners[0].id,
    qty_committed: 500,
    commitment_date: daysAgo(10),
    valid_until: daysAgo(5),
    evidence_note: "E2E expired commitment",
  });
  const expired = await coverage(lineC);
  record(
    "T4.1 An expired commitment is excluded",
    Number(expired.qty_committed) === 0 && Number(expired.qty_uncovered) === 1000,
    `committed ${expired.qty_committed}, uncovered ${expired.qty_uncovered}`,
  );

  // T4.2 · Override appears on the view and in the audit log ----------------
  const overrideId = await owner.rpc("request_coverage_override", {
    p_requirement_line_id: lineA,
    p_gap_qty: 400,
    p_reason: "Owner accepts residual risk E2E",
    p_risk: "Partial coverage",
    p_mitigation: "Substitute source identified",
  });
  const requested = await admin
    .from("coverage_override")
    .select("id, status, approval_id")
    .eq("id", overrideId.data as string)
    .single();
  record(
    "T4.2 Override requested with an approval record",
    !overrideId.error &&
      requested.data?.status === "requested" &&
      Boolean(requested.data?.approval_id),
    overrideId.error?.message ?? `status ${requested.data?.status}`,
  );

  await owner.rpc("decide_approval", {
    p_approval_id: requested.data!.approval_id as string,
    p_decision: "approved",
    p_comment: "Approved by Owner (E2E)",
  });
  // Mirror src/lib/actions/approvals.ts.
  await owner
    .from("coverage_override")
    .update({ status: "approved" })
    .eq("id", overrideId.data as string);

  const overridden = await coverage(lineA);
  const tileD08 = await owner
    .from("v_tile_d08")
    .select("requirement_line_id")
    .eq("requirement_line_id", lineA);
  const audit = await admin
    .from("audit_events")
    .select("id", { count: "exact", head: true })
    .eq("table_name", "coverage_override")
    .eq("record_id", overrideId.data as string);

  record(
    "T4.2 Approved override is visible on the view and excludes the line from D-08",
    overridden.has_approved_override === true && (tileD08.data?.length ?? 0) === 0,
    `has_approved_override ${overridden.has_approved_override}, D-08 rows for line ${tileD08.data?.length ?? 0}`,
  );
  record(
    "T4.2 The override is in the audit log",
    (audit.count ?? 0) > 0,
    `${audit.count ?? 0} audit row(s)`,
  );

  // T4.3 · Tile D-08 count equals its drill-down list ------------------------
  const kpi = await owner
    .from("v_dashboard_kpis")
    .select("count_value")
    .eq("tile_code", "D-08")
    .maybeSingle();
  const tileRows = await owner.from("v_tile_d08").select("requirement_line_id");
  record(
    "T4.3 Tile D-08 count equals its drill-down rows",
    (kpi.data?.count_value ?? -1) === (tileRows.data?.length ?? -2),
    `tile ${kpi.data?.count_value ?? "n/a"}, rows ${tileRows.data?.length ?? "n/a"}`,
  );

  // Cleanup -----------------------------------------------------------------
  await admin.from("requirement").delete().eq("id", req.id);

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
