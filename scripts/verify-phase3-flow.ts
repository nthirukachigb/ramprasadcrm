/**
 * Phase 3 end-to-end flow walkthrough (steps B–D) against a live Supabase
 * project. This mirrors exactly what the /requirements/[id]/sourcing UI does:
 * it calls the same tables and RPCs as the server actions in
 * src/lib/actions/sourcing.ts.
 *
 *   npm run verify:phase3-flow
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

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const password = process.env.DEMO_USER_PASSWORD!;
  if (!url || !anon || !service || !password) {
    throw new Error("Missing env. Check .env.local.");
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

  const customer = await admin.from("customer").select("id").limit(1).maybeSingle();
  const partner = await admin.from("partner").select("id, name").limit(1).maybeSingle();
  if (!customer.data || !partner.data) throw new Error("Seed masters first.");

  console.log(`\nEndpoint: ${url}`);
  console.log(`Partner:  ${partner.data.name}\n`);

  // Fixture -----------------------------------------------------------------
  const { data: req, error: reqErr } = await admin
    .from("requirement")
    .insert({
      requirement_type: "enquiry",
      customer_id: customer.data.id,
      source_channel: "email",
      customer_reference: `E2E-P3-${Date.now()}`,
      enquiry_date: new Date().toISOString().slice(0, 10),
    })
    .select("id")
    .single();
  if (reqErr) throw new Error(reqErr.message);

  const { data: line, error: lineErr } = await admin
    .from("requirement_line")
    .insert({
      requirement_id: req.id,
      line_no: 1,
      description: "E2E 24V power supply",
      quantity_required: 1000,
      uom: "NO",
    })
    .select("id")
    .single();
  if (lineErr) throw new Error(lineErr.message);

  // B. Request + response ----------------------------------------------------
  const { data: request, error: requestErr } = await owner
    .from("sourcing_request")
    .insert({
      requirement_id: req.id,
      partner_id: partner.data.id,
      status: "sent",
      response_due_date: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
      created_by: (await owner.auth.getUser()).data.user?.id,
    })
    .select("id")
    .single();
  record("B1 Sourcing request created and marked sent", !requestErr && !!request?.id, requestErr?.message ?? "ok");

  const { data: requestLine, error: requestLineErr } = await owner
    .from("sourcing_request_line")
    .insert({
      request_id: request!.id,
      requirement_line_id: line.id,
      qty_requested: 1000,
    })
    .select("id")
    .single();
  record("B2 Request line added", !requestLineErr && !!requestLine?.id, requestLineErr?.message ?? "ok");

  // Response with 800 available, 0 committed.
  const { data: response1 } = await owner
    .from("oem_response")
    .insert({ request_id: request!.id, partner_id: partner.data.id, status: "received" })
    .select("id")
    .single();
  const { data: responseLine1 } = await owner
    .from("oem_response_line")
    .insert({
      response_id: response1!.id,
      sourcing_request_line_id: requestLine!.id,
      unit_price: 1250,
      lead_time_days: 45,
    })
    .select("id")
    .single();
  await owner.from("quantity_indication").insert({
    response_line_id: responseLine1!.id,
    qty_available_indicated: 800,
  });

  const committedAfterAvailable = await owner.rpc("committed_qty", {
    p_requirement_line_id: line.id,
  });
  record(
    "B3 800 available / 0 committed keeps firm coverage at 0",
    Number(committedAfterAvailable.data) === 0,
    `committed_qty = ${committedAfterAvailable.data}`,
  );

  // Response with a firm commitment + evidence.
  const noEvidence = await owner.from("quantity_commitment").insert({
    requirement_line_id: line.id,
    partner_id: partner.data.id,
    qty_committed: 300,
  });
  record(
    "B4 A firm commitment without evidence is rejected",
    Boolean(noEvidence.error) && noEvidence.error?.code === "23514",
    noEvidence.error ? `code ${noEvidence.error.code}` : "allowed without evidence",
  );

  const { data: commitment1 } = await owner
    .from("quantity_commitment")
    .insert({
      requirement_line_id: line.id,
      partner_id: partner.data.id,
      response_line_id: responseLine1!.id,
      qty_committed: 300,
      evidence_note: "OEM email 30-Sep confirmation E2E",
    })
    .select("id, version, status")
    .single();
  const committedAfterFirm = await owner.rpc("committed_qty", {
    p_requirement_line_id: line.id,
  });
  record(
    "B5 Firm commitment of 300 with evidence raises coverage to 300",
    !commitment1 ? false : Number(committedAfterFirm.data) === 300,
    `committed_qty = ${committedAfterFirm.data}`,
  );

  // C. Change and withdraw ---------------------------------------------------
  const changed = await owner.rpc("change_commitment", {
    p_id: commitment1!.id,
    p_new_qty: 200,
    p_reason: "OEM revised quantity E2E",
  });
  const oldRow = await admin
    .from("quantity_commitment")
    .select("status")
    .eq("id", commitment1!.id)
    .single();
  const newRow = await admin
    .from("quantity_commitment")
    .select("version, status, qty_committed, supersedes_id")
    .eq("id", changed.data as string)
    .single();
  const committedAfterChange = await owner.rpc("committed_qty", {
    p_requirement_line_id: line.id,
  });
  record(
    "C1 change_commitment creates v2 (200) and marks v1 changed",
    !changed.error &&
      oldRow.data?.status === "changed" &&
      newRow.data?.version === 2 &&
      newRow.data?.status === "active" &&
      Number(newRow.data?.qty_committed) === 200 &&
      newRow.data?.supersedes_id === commitment1!.id &&
      Number(committedAfterChange.data) === 200,
    changed.error?.message ?? `v2 active 200, v1 changed, committed ${committedAfterChange.data}`,
  );

  const withdrawn = await owner.rpc("withdraw_commitment", {
    p_id: changed.data as string,
    p_reason: "OEM withdrew E2E",
  });
  const committedAfterWithdraw = await owner.rpc("committed_qty", {
    p_requirement_line_id: line.id,
  });
  record(
    "C2 Withdrawing 200 drops firm coverage to 0",
    !withdrawn.error && Number(committedAfterWithdraw.data) === 0,
    withdrawn.error?.message ?? `committed_qty = ${committedAfterWithdraw.data}`,
  );

  // D. Selection approval ----------------------------------------------------
  const { data: commitment2 } = await owner
    .from("quantity_commitment")
    .insert({
      requirement_line_id: line.id,
      partner_id: partner.data.id,
      qty_committed: 300,
      evidence_note: "Second commitment for selection E2E",
    })
    .select("id")
    .single();

  const overAllocate = await owner.from("oem_selection").insert({
    requirement_line_id: line.id,
    partner_id: partner.data.id,
    qty_allocated: 400,
  });
  record(
    "D1 Allocating 400 above a 300 commitment is blocked",
    Boolean(overAllocate.error) &&
      /SELECTION_EXCEEDS_COMMITMENT/.test(overAllocate.error?.message ?? ""),
    overAllocate.error ? overAllocate.error.message.split("\n")[0] : "allowed",
  );

  const { data: selection } = await owner
    .from("oem_selection")
    .insert({
      requirement_line_id: line.id,
      partner_id: partner.data.id,
      qty_allocated: 250,
      status: "proposed",
    })
    .select("id")
    .single();
  record("D2 Selection of 250 (within commitment) proposed", !!selection && !!commitment2, "ok");

  // Mirror src/lib/actions/sourcing.ts proposeSelection: request approval.
  const approval = await sales.rpc("request_approval", {
    p_subject_type: "oem_selection",
    p_subject_id: selection!.id,
    p_reason: "OEM selection for 250 unit(s)",
  });
  await sales
    .from("oem_selection")
    .update({ approval_id: (approval.data as string) ?? null })
    .eq("id", selection!.id);

  const salesApprove = await sales.rpc("decide_approval", {
    p_approval_id: approval.data as string,
    p_decision: "approved",
    p_comment: "sales trying to self-approve",
  });
  record(
    "D3 Sales cannot approve the selection",
    Boolean(salesApprove.error) && /FORBIDDEN/.test(salesApprove.error?.message ?? ""),
    salesApprove.error ? salesApprove.error.message.split("\n")[0] : "sales approved",
  );

  const ownerApprove = await owner.rpc("decide_approval", {
    p_approval_id: approval.data as string,
    p_decision: "approved",
    p_comment: "Approved by Owner (E2E)",
  });
  // Mirror src/lib/actions/approvals.ts: owner approval sets the selection.
  await owner.from("oem_selection").update({ status: "approved" }).eq("id", selection!.id);
  const finalSelection = await admin
    .from("oem_selection")
    .select("status, approval_id")
    .eq("id", selection!.id)
    .single();
  record(
    "D4 Owner approval marks the selection approved",
    !ownerApprove.error &&
      finalSelection.data?.status === "approved" &&
      finalSelection.data?.approval_id === approval.data,
    ownerApprove.error?.message ?? `status ${finalSelection.data?.status}`,
  );

  // Cleanup
  await admin.from("requirement").delete().eq("id", req.id);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} steps passed.`);
  if (failed.length > 0) {
    console.log("Failed steps:");
    for (const step of failed) console.log(`  - ${step.name}: ${step.detail}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
