/**
 * Phase 8 acceptance verification (T8.1 readiness, T8.2 PDI, T8.3 dispatch gate)
 * against a live Supabase project.
 *
 *   npm run verify:phase8
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
  console.log(`${pass ? "PASS" : "FAIL"}  ${name} â€” ${detail}`);
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
      customer_reference: `E2E-P8-${Date.now()}`,
      enquiry_date: today(),
    })
    .select("id")
    .single();
  const { data: line } = await admin
    .from("requirement_line")
    .insert({
      requirement_id: req!.id,
      line_no: 1,
      description: "E2E P8 line",
      internal_part_no: `E2E-P8-${Date.now()}`,
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
  // A second line is prepared while the version is still Draft (it is needed
  // for the delivery/acceptance scenario and cannot be added after approval).
  const { data: line2, error: line2Err } = await admin
    .from("requirement_line")
    .insert({
      requirement_id: req!.id,
      line_no: 2,
      description: "E2E P8 delivery line",
      internal_part_no: `E2E-P8B-${Date.now()}`,
      quantity_required: 1000,
      uom: "NO",
    })
    .select("id")
    .single();
  if (line2Err) throw new Error(`line2: ${line2Err.message}`);
  const { data: ql2, error: ql2Err } = await admin
    .from("quotation_line")
    .insert({
      quotation_version_id: version!.id,
      requirement_line_id: line2!.id,
      qty_quoted: 1000,
      uom: "NO",
      unit_cost: 60,
      proposed_unit_price: 100,
      sourcing_basis: "in_house",
    })
    .select("id")
    .single();
  if (ql2Err) throw new Error(`ql2: ${ql2Err.message}`);
  await admin
    .from("quotation_version")
    .update({ status: "approved", approved_at: new Date().toISOString() })
    .eq("id", version!.id);
  await admin
    .from("quotation")
    .update({ current_version_id: version!.id })
    .eq("id", quotation!.id);

  const { data: po } = await owner
    .from("customer_po")
    .insert({
      quotation_version_id: version!.id,
      customer_id: customer.data.id,
      customer_po_number: `PO-P8-${Date.now()}`,
    })
    .select("id")
    .single();
  const { data: poLine } = await owner
    .from("po_line")
    .insert({
      customer_po_id: po!.id,
      quotation_line_id: (
        await admin
          .from("quotation_line")
          .select("id")
          .eq("quotation_version_id", version!.id)
          .eq("requirement_line_id", line!.id)
          .single()
      ).data!.id,
      requirement_line_id: line!.id,
      qty_ordered: 1000,
      qty_ordered_effective: 1000,
      unit_rate: 100,
      uom: "NO",
    })
    .select("id")
    .single();

  // T8.1 Â· Milestones seeded + readiness cap --------------------------------
  const milestones = await admin
    .from("fulfilment_milestone")
    .select("id", { count: "exact", head: true })
    .eq("customer_po_id", po!.id);
  record(
    "T8.1 Milestones are seeded when a customer PO is created",
    (milestones.count ?? 0) >= 5,
    `${milestones.count ?? 0} milestone(s)`,
  );

  const ready = await owner.from("material_readiness").insert({
    customer_po_id: po!.id,
    po_line_id: poLine!.id,
    ready_qty: 300,
  });
  const overReady = await owner.from("material_readiness").insert({
    customer_po_id: po!.id,
    po_line_id: poLine!.id,
    ready_qty: 1100,
  });
  record(
    "T8.1 300 ready is recorded; 1,100 ready is rejected (US-09)",
    !ready.error && Boolean(overReady.error) && /US-09/.test(overReady.error?.message ?? ""),
    overReady.error?.message.split("\n")[0] ?? "over-ready allowed",
  );

  // T8.2 Â· PDI quantities ---------------------------------------------------
  const { data: pdi } = await owner
    .from("pdi")
    .insert({ customer_po_id: po!.id, status: "called" })
    .select("id")
    .single();
  const pdiLine = await owner
    .from("pdi_line")
    .insert({ pdi_id: pdi!.id, po_line_id: poLine!.id, qty_offered: 100, qty_cleared: 90, qty_rejected: 6, qty_held: 4 })
    .select("id")
    .single();
  record(
    "T8.2 100 offered = 90 cleared + 6 rejected + 4 held saves",
    !pdiLine.error,
    pdiLine.error?.message ?? "ok",
  );

  const badSum = await owner
    .from("pdi_line")
    .update({ qty_cleared: 95, qty_rejected: 6, qty_held: 0 })
    .eq("id", pdiLine.data!.id);
  record(
    "T8.2 95 + 6 on 100 fails (FR-PDI-02)",
    Boolean(badSum.error) && badSum.error?.code === "23514",
    badSum.error ? `code ${badSum.error.code}` : "bad sum allowed",
  );

  const { data: pdi2 } = await owner
    .from("pdi")
    .insert({ customer_po_id: po!.id, status: "called" })
    .select("id")
    .single();
  const overOffer = await owner.from("pdi_line").insert({
    pdi_id: pdi2!.id,
    po_line_id: poLine!.id,
    qty_offered: 1000,
  });
  record(
    "T8.2 A PDI call above the ready quantity is rejected",
    Boolean(overOffer.error) && /FR-PDI-02/.test(overOffer.error?.message ?? ""),
    overOffer.error?.message.split("\n")[0] ?? "over-offer allowed",
  );

  // T8.3 Â· Dispatch gate and override ---------------------------------------
  const { data: dispatch } = await owner
    .from("dispatch")
    .insert({ customer_po_id: po!.id })
    .select("id")
    .single();
  const overDispatch = await owner
    .from("dispatch_line")
    .insert({ dispatch_id: dispatch!.id, po_line_id: poLine!.id, qty: 100 });
  record(
    "T8.3 Dispatching 100 when only 90 is cleared fails with BR-13",
    Boolean(overDispatch.error) && /BR-13/.test(overDispatch.error?.message ?? ""),
    overDispatch.error?.message.split("\n")[0] ?? "over-dispatch allowed",
  );

  const okDispatch = await owner
    .from("dispatch_line")
    .insert({ dispatch_id: dispatch!.id, po_line_id: poLine!.id, qty: 90 });
  const balanceAfter = await owner
    .from("v_po_line_balance")
    .select("qty_cleared, qty_dispatched, qty_dispatchable")
    .eq("po_line_id", poLine!.id)
    .single();
  record(
    "T8.3 Dispatching 90 succeeds and leaves 0 dispatchable",
    !okDispatch.error &&
      Number(balanceAfter.data?.qty_cleared) === 90 &&
      Number(balanceAfter.data?.qty_dispatchable) === 0,
    okDispatch.error?.message ?? `dispatchable ${balanceAfter.data?.qty_dispatchable}`,
  );

  const overrideId = await owner.rpc("request_dispatch_override", {
    p_po_line_id: poLine!.id,
    p_qty: 10,
    p_reason: "Owner accepts the held quantity (E2E)",
  });
  const { data: overrideRow } = await admin
    .from("dispatch_override")
    .select("approval_id")
    .eq("id", overrideId.data as string)
    .single();
  await owner.rpc("decide_approval", {
    p_approval_id: overrideRow!.approval_id as string,
    p_decision: "approved",
    p_comment: "Approved by Owner (E2E)",
  });
  await owner
    .from("dispatch_override")
    .update({ status: "approved" })
    .eq("id", overrideId.data as string);

  const { data: dispatch2 } = await owner
    .from("dispatch")
    .insert({ customer_po_id: po!.id })
    .select("id")
    .single();
  const overrideDispatch = await owner
    .from("dispatch_line")
    .insert({
      dispatch_id: dispatch2!.id,
      po_line_id: poLine!.id,
      qty: 10,
      override_id: overrideId.data as string,
    })
    .select("override_id")
    .single();
  record(
    "T8.3 With an approved override, dispatching 10 more succeeds and carries override_id",
    !overrideDispatch.error && overrideDispatch.data?.override_id === overrideId.data,
    overrideDispatch.error?.message ?? "ok",
  );

  // T8.5 Â· Delivery, acceptance and closure --------------------------------
  const { data: poLine2 } = await owner
    .from("po_line")
    .insert({
      customer_po_id: po!.id,
      quotation_line_id: ql2!.id,
      requirement_line_id: line2!.id,
      qty_ordered: 1000,
      qty_ordered_effective: 1000,
      unit_rate: 100,
      uom: "NO",
    })
    .select("id")
    .single();
  await owner.from("material_readiness").insert({
    customer_po_id: po!.id,
    po_line_id: poLine2!.id,
    ready_qty: 1000,
  });
  const { data: pdiB } = await owner
    .from("pdi")
    .insert({ customer_po_id: po!.id, status: "called" })
    .select("id")
    .single();
  await owner.from("pdi_line").insert({
    pdi_id: pdiB!.id,
    po_line_id: poLine2!.id,
    qty_offered: 1000,
    qty_cleared: 1000,
  });
  const { data: dispatchB } = await owner
    .from("dispatch")
    .insert({ customer_po_id: po!.id })
    .select("id")
    .single();
  await owner
    .from("dispatch_line")
    .insert({ dispatch_id: dispatchB!.id, po_line_id: poLine2!.id, qty: 1000 });
  const { data: deliveryB } = await owner
    .from("delivery")
    .insert({ customer_po_id: po!.id, dispatch_id: dispatchB!.id, status: "delivered" })
    .select("id")
    .single();
  await owner
    .from("delivery_line")
    .insert({ delivery_id: deliveryB!.id, po_line_id: poLine2!.id, qty: 1000 });

  const overDeliver = await owner.from("delivery_line").insert({
    delivery_id: (
      await owner.from("delivery").insert({ customer_po_id: po!.id }).select("id").single()
    ).data!.id,
    po_line_id: poLine2!.id,
    qty: 1,
  });
  record(
    "T8.5 Delivering beyond the dispatched quantity fails (BR-07)",
    Boolean(overDeliver.error) && /BR-07/.test(overDeliver.error?.message ?? ""),
    overDeliver.error?.message.split("\n")[0] ?? "over-delivery allowed",
  );

  for (const accepted of [300, 200]) {
    const { data: acc } = await owner
      .from("acceptance")
      .insert({ customer_po_id: po!.id, delivery_id: deliveryB!.id, status: "accepted" })
      .select("id")
      .single();
    await owner
      .from("acceptance_line")
      .insert({ acceptance_id: acc!.id, po_line_id: poLine2!.id, qty_accepted: accepted });
  }
  const balance1 = await owner
    .from("v_po_line_balance")
    .select("qty_accepted, qty_outstanding")
    .eq("po_line_id", poLine2!.id)
    .single();
  record(
    "T8.5 Ordered 1,000 with accepted 300 + 200 â†’ outstanding 500",
    Number(balance1.data?.qty_accepted) === 500 && Number(balance1.data?.qty_outstanding) === 500,
    `accepted ${balance1.data?.qty_accepted}, outstanding ${balance1.data?.qty_outstanding}`,
  );

  const { data: accC } = await owner
    .from("acceptance")
    .insert({ customer_po_id: po!.id, delivery_id: deliveryB!.id, status: "rejected" })
    .select("id")
    .single();
  await owner
    .from("acceptance_line")
    .insert({ acceptance_id: accC!.id, po_line_id: poLine2!.id, qty_rejected: 10 });
  const balance2 = await owner
    .from("v_po_line_balance")
    .select("qty_outstanding")
    .eq("po_line_id", poLine2!.id)
    .single();
  const rejectTask = await admin
    .from("task")
    .select("id", { count: "exact", head: true })
    .eq("rule_id", "delivery_rejected")
    .eq("source_entity_id", poLine2!.id)
    .eq("status", "open");
  record(
    "T8.5 Rejecting 10 raises outstanding to 510 and creates a replacement task",
    Number(balance2.data?.qty_outstanding) === 510 && (rejectTask.count ?? 0) >= 1,
    `outstanding ${balance2.data?.qty_outstanding}, tasks ${rejectTask.count ?? 0}`,
  );

  // T8.6 · Delivery risk, extension gate and jobs ---------------------------
  const future = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  const forecast = new Date(Date.now() + 25 * 86400000).toISOString().slice(0, 10);
  const { data: schedule } = await owner
    .from("po_delivery_schedule")
    .insert({
      po_line_id: poLine2!.id,
      sequence: 1,
      qty: 1000,
      due_date: future,
      original_committed_date: future,
      forecast_date: forecast,
    })
    .select("id")
    .single();
  const risk = await owner
    .from("v_delivery_risk")
    .select("risk_status")
    .eq("schedule_id", schedule!.id)
    .single();
  record(
    "T8.6 A forecast 5 days after the committed date shows at risk",
    risk.data?.risk_status === "at_risk",
    `risk_status ${risk.data?.risk_status}`,
  );

  const kpiD06 = await owner
    .from("v_dashboard_kpis")
    .select("count_value")
    .eq("tile_code", "D-06")
    .maybeSingle();
  const tile06 = await owner.from("v_tile_d06").select("customer_po_id");
  const distinctPo = Array.from(
    new Set((tile06.data ?? []).map((row) => row.customer_po_id as string)),
  ).length;
  record(
    "T8.6 Tile D-06 count equals its distinct-PO drill-down",
    (kpiD06.data?.count_value ?? -1) === distinctPo,
    `tile ${kpiD06.data?.count_value ?? "n/a"}, distinct POs ${distinctPo}`,
  );

  const riskJob1 = await owner.rpc("run_job", { p_job: "delivery_risk_refresh", p_triggered_by: "verify" });
  const riskJob2 = await owner.rpc("run_job", { p_job: "delivery_risk_refresh", p_triggered_by: "verify" });
  const riskTasks = await admin
    .from("task")
    .select("id", { count: "exact", head: true })
    .eq("rule_id", "delivery_risk")
    .eq("source_entity_id", poLine2!.id)
    .eq("status", "open");
  record(
    "T8.6 The delivery-risk job creates one task and is idempotent",
    Number(riskJob1.data) >= 1 && Number(riskJob2.data) === 0 && (riskTasks.count ?? 0) === 1,
    `runs ${riskJob1.data}/${riskJob2.data}, open ${riskTasks.count ?? 0}`,
  );

  const extension = await owner
    .from("extension_request")
    .insert({
      customer_po_id: po!.id,
      po_line_id: poLine2!.id,
      requested_date: new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10),
      reason: "Supplier capacity",
    })
    .select("id")
    .single();
  await owner.rpc("transition_extension_request", {
    p_id: extension.data!.id,
    p_to_status: "pending_approval",
    p_reason: "for approval",
  });
  // Move to approved without the Owner's decision, then try to send.
  await owner.rpc("transition_extension_request", {
    p_id: extension.data!.id,
    p_to_status: "approved",
    p_reason: "status only",
  });
  const sendBlocked = await owner.rpc("transition_extension_request", {
    p_id: extension.data!.id,
    p_to_status: "sent",
    p_reason: "try send",
  });
  record(
    "T8.6 A letter cannot be marked Sent without approval (FR-RISK-02)",
    Boolean(sendBlocked.error) && /FR-RISK-02/.test(sendBlocked.error?.message ?? ""),
    sendBlocked.error?.message.split("\n")[0] ?? "sent without approval",
  );

  const { data: extRow } = await admin
    .from("extension_request")
    .select("approval_id")
    .eq("id", extension.data!.id)
    .single();
  await owner.rpc("decide_approval", {
    p_approval_id: extRow!.approval_id as string,
    p_decision: "approved",
    p_comment: "Owner approved the extension (E2E)",
  });
  const sent = await owner.rpc("transition_extension_request", {
    p_id: extension.data!.id,
    p_to_status: "sent",
    p_reason: "sent to customer",
  });
  const granted = await owner.rpc("transition_extension_request", {
    p_id: extension.data!.id,
    p_to_status: "granted",
    p_reason: "customer granted",
  });
  const revised = await admin
    .from("po_delivery_schedule")
    .select("due_date")
    .eq("id", schedule!.id)
    .single();
  const requestedDate = new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10);
  record(
    "T8.6 After approval the letter can be sent, and granting revises the date",
    !sent.error && !granted.error && revised.data?.due_date === requestedDate,
    sent.error?.message ?? granted.error?.message ?? `due ${revised.data?.due_date}`,
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


