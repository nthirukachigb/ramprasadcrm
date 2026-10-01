/**
 * Phase 6 acceptance verification (T6.1 response, T6.2 tasks, T6.4 outcome)
 * against a live Supabase project.
 *
 *   npm run verify:phase6
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
  if (!customer.data) throw new Error("Seed masters first.");

  const { data: req } = await admin
    .from("requirement")
    .insert({
      requirement_type: "enquiry",
      customer_id: customer.data.id,
      source_channel: "email",
      customer_reference: `E2E-P6-${Date.now()}`,
      enquiry_date: today(),
    })
    .select("id")
    .single();
  const { data: line } = await admin
    .from("requirement_line")
    .insert({
      requirement_id: req!.id,
      line_no: 1,
      description: "E2E P6 line",
      internal_part_no: `E2E-P6-${Date.now()}`,
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
  const { data: version } = await admin
    .from("quotation_version")
    .insert({ quotation_id: quotation!.id, version_no: 1, status: "draft" })
    .select("id")
    .single();
  await admin.from("quotation_line").insert({
    quotation_version_id: version!.id,
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
    .eq("id", version!.id);
  await admin
    .from("quotation")
    .update({ current_version_id: version!.id })
    .eq("id", quotation!.id);

  // T6.1 · Response transitions create status_history -----------------------
  const { data: response } = await owner
    .from("customer_response")
    .insert({ quotation_id: quotation!.id, status: "submitted" })
    .select("id")
    .single();
  const moved = await owner.rpc("transition_customer_response", {
    p_id: response!.id,
    p_to_status: "clarification_requested",
    p_reason: "Customer asked for a spec",
  });
  const history = await admin
    .from("status_history")
    .select("id", { count: "exact", head: true })
    .eq("entity_type", "customer_response")
    .eq("entity_id", response!.id);
  record(
    "T6.1 A response state change creates a status_history row",
    !moved.error && (history.count ?? 0) >= 1,
    moved.error?.message ?? `${history.count ?? 0} history row(s)`,
  );

  const invalid = await owner.rpc("transition_customer_response", {
    p_id: response!.id,
    p_to_status: "won",
    p_reason: "not allowed from clarification",
  });
  record(
    "T6.1 An invalid response transition is rejected",
    Boolean(invalid.error) && /BR-30/.test(invalid.error?.message ?? ""),
    invalid.error?.message.split("\n")[0] ?? "invalid transition allowed",
  );

  // T6.1 · PNC price needs an approved version ------------------------------
  const pncBad = await owner.from("negotiation_event").insert({
    customer_response_id: response!.id,
    event_type: "pnc",
    price_change_requested: true,
    requested_price: 90,
    agreed: true,
  });
  record(
    "T6.1 An agreed PNC price without an approved version is rejected",
    Boolean(pncBad.error) && /FR-RESP-03/.test(pncBad.error?.message ?? ""),
    pncBad.error?.message.split("\n")[0] ?? "agreed PNC allowed",
  );

  const pncOk = await owner.from("negotiation_event").insert({
    customer_response_id: response!.id,
    event_type: "pnc",
    price_change_requested: true,
    requested_price: 95,
    agreed: true,
    approved_version_id: version!.id,
  });
  record(
    "T6.1 An agreed PNC linked to an approved version is accepted",
    !pncOk.error,
    pncOk.error?.message ?? "ok",
  );

  // T6.2 · Task dedupe ------------------------------------------------------
  const firstTask = await owner.rpc("ensure_task", {
    p_rule_id: "clarification_open",
    p_entity_type: "clarification",
    p_entity_id: line!.id,
    p_title: "E2E task",
    p_owner: null,
    p_due: today(),
    p_priority: "medium",
  });
  const secondTask = await owner.rpc("ensure_task", {
    p_rule_id: "clarification_open",
    p_entity_type: "clarification",
    p_entity_id: line!.id,
    p_title: "E2E task",
    p_owner: null,
    p_due: today(),
    p_priority: "medium",
  });
  const taskCount = await admin
    .from("task")
    .select("id", { count: "exact", head: true })
    .eq("rule_id", "clarification_open")
    .eq("source_entity_id", line!.id)
    .eq("status", "open");
  record(
    "T6.2 A rule does not create duplicate open tasks",
    !firstTask.error && !secondTask.error && (taskCount.count ?? 0) === 1,
    `created ${firstTask.data ? 1 : 0}+${secondTask.data ? 1 : 0}, open ${taskCount.count ?? 0}`,
  );

  // T6.2 · Deadline-TBC hook creates a task, linked to one source
  const { data: reqTbc } = await admin
    .from("requirement")
    .insert({
      requirement_type: "enquiry",
      customer_id: customer.data.id,
      source_channel: "email",
      customer_reference: `E2E-P6-TBC-${Date.now()}`,
      enquiry_date: today(),
      deadline_tbc: true,
    })
    .select("id")
    .single();
  const tbcTask = await admin
    .from("task")
    .select("source_entity_type, source_entity_id")
    .eq("rule_id", "deadline_tbc")
    .eq("source_entity_id", reqTbc!.id);
  record(
    "T6.2 A deadline-TBC requirement creates a linked task",
    (tbcTask.data?.length ?? 0) === 1 &&
      tbcTask.data?.[0]?.source_entity_type === "requirement",
    `${tbcTask.data?.length ?? 0} task(s)`,
  );

  // T6.4 · Partial award ----------------------------------------------------
  const outcome = await owner.from("line_outcome").insert({
    quotation_version_id: version!.id,
    requirement_line_id: line!.id,
    outcome: "partially_won",
    qty_won: 600,
    qty_lost: 400,
    loss_reason_code: "QTY_SPLIT",
    winning_price: 105,
  });
  const derived = await owner
    .from("v_requirement_outcome")
    .select("qty_won, qty_lost, derived_outcome, has_qty_split")
    .eq("requirement_id", req!.id)
    .single();
  record(
    "T6.4 Quoted 1,000 with 600 awarded → partially won, 400 lost",
    !outcome.error &&
      Number(derived.data?.qty_won) === 600 &&
      Number(derived.data?.qty_lost) === 400 &&
      derived.data?.derived_outcome === "partially_won" &&
      derived.data?.has_qty_split === true,
    outcome.error?.message ?? `won ${derived.data?.qty_won}, lost ${derived.data?.qty_lost}, ${derived.data?.derived_outcome}`,
  );

  const lostNoReason = await owner.from("line_outcome").insert({
    quotation_version_id: version!.id,
    requirement_line_id: line!.id,
    outcome: "lost",
    qty_lost: 100,
  });
  record(
    "T6.4 A lost line without a reason is rejected (BR-29)",
    Boolean(lostNoReason.error) && /BR-29/.test(lostNoReason.error?.message ?? ""),
    lostNoReason.error?.message.split("\n")[0] ?? "lost without reason allowed",
  );

  const otherNoText = await owner.from("line_outcome").insert({
    quotation_version_id: version!.id,
    requirement_line_id: line!.id,
    outcome: "lost",
    qty_lost: 100,
    loss_reason_code: "OTHER",
  });
  record(
    "T6.4 Loss reason OTHER without text is rejected",
    Boolean(otherNoText.error) && otherNoText.error?.code === "23514",
    otherNoText.error ? `code ${otherNoText.error.code}` : "OTHER without text allowed",
  );

  const overWon = await owner.from("line_outcome").insert({
    quotation_version_id: version!.id,
    requirement_line_id: line!.id,
    outcome: "won",
    qty_won: 1200,
  });
  record(
    "T6.4 Awarded quantity above quoted is rejected (FR-RESP-04)",
    Boolean(overWon.error) && /FR-RESP-04/.test(overWon.error?.message ?? ""),
    overWon.error?.message.split("\n")[0] ?? "over-award allowed",
  );

  // T6.3 · Scheduled jobs with a frozen clock --------------------------------
  await admin.from("app_setting").upsert(
    { key: "now_override", value_text: "2026-12-31T00:00:00Z" },
    { onConflict: "key" },
  );

  await admin
    .from("requirement")
    .update({ submission_deadline: "2027-01-02T00:00:00Z" })
    .eq("id", req!.id);
  const runDeadline = await owner.rpc("run_job", {
    p_job: "quotation_deadlines",
    p_triggered_by: "verify",
  });
  const deadlineTasks = await admin
    .from("task")
    .select("id", { count: "exact", head: true })
    .eq("rule_id", "quotation_deadline")
    .eq("source_entity_id", req!.id)
    .eq("status", "open");
  record(
    "T6.3 The quotation-deadline job creates a task",
    !runDeadline.error && (deadlineTasks.count ?? 0) >= 1,
    runDeadline.error?.message ?? `${deadlineTasks.count ?? 0} task(s)`,
  );

  const { data: v2 } = await admin
    .from("quotation_version")
    .insert({ quotation_id: quotation!.id, version_no: 2, status: "draft", version_reason: "revised" })
    .select("id")
    .single();
  await admin
    .from("quotation_version")
    .update({ status: "submitted", submitted_at: "2026-12-20T00:00:00Z" })
    .eq("id", v2!.id);
  await admin
    .from("quotation")
    .update({ current_version_id: v2!.id })
    .eq("id", quotation!.id);
  await admin
    .from("customer_response")
    .insert({ quotation_id: quotation!.id, status: "submitted" });

  const runNoResp1 = await owner.rpc("run_job", {
    p_job: "customer_no_response",
    p_triggered_by: "verify",
  });
  const runNoResp2 = await owner.rpc("run_job", {
    p_job: "customer_no_response",
    p_triggered_by: "verify",
  });
  const noRespTasks = await admin
    .from("task")
    .select("id", { count: "exact", head: true })
    .eq("rule_id", "customer_no_response")
    .eq("source_entity_id", quotation!.id)
    .eq("status", "open");
  record(
    "T6.3 The no-response job creates one task and running it twice is idempotent",
    Number(runNoResp1.data) >= 1 &&
      Number(runNoResp2.data) === 0 &&
      (noRespTasks.count ?? 0) === 1,
    `runs ${runNoResp1.data}/${runNoResp2.data}, open ${noRespTasks.count ?? 0}`,
  );

  await admin.from("app_setting").update({ value_text: null }).eq("key", "now_override");

  // Cleanup -----------------------------------------------------------------
  await admin.from("requirement").delete().eq("id", req!.id);
  await admin.from("requirement").delete().eq("id", reqTbc!.id);

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
