/**
 * Phase 5 workflow walkthrough (T5.2–T5.6) against a live Supabase project:
 * create from requirement (gates), submit for approval, owner approval,
 * revision, submission record and bid history.
 *
 *   npm run verify:phase5-flow
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

const iso = (d: Date) => d.toISOString();
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
  const sales = await signIn("sales@demo.local");
  const operations = await signIn("operations@demo.local");

  const customer = await admin.from("customer").select("id").limit(1).maybeSingle();
  const partner = await admin.from("partner").select("id").limit(1).maybeSingle();
  if (!customer.data || !partner.data) throw new Error("Seed masters first.");

  // Fixture: a fully gated requirement (covered + checklist closed).
  const { data: req } = await admin
    .from("requirement")
    .insert({
      requirement_type: "enquiry",
      customer_id: customer.data.id,
      source_channel: "email",
      customer_reference: `E2E-P5FLOW-${Date.now()}`,
      enquiry_date: daysAgo(10),
    })
    .select("id")
    .single();
  const { data: line } = await admin
    .from("requirement_line")
    .insert({
      requirement_id: req!.id,
      line_no: 1,
      description: "E2E flow power supply",
      internal_part_no: `E2E-P5FLOW-${Date.now()}`,
      quantity_required: 1000,
      uom: "NO",
    })
    .select("id")
    .single();
  await admin.from("quantity_commitment").insert({
    requirement_line_id: line!.id,
    partner_id: partner.data.id,
    qty_committed: 1000,
    evidence_note: "E2E flow commitment",
  });
  await admin
    .from("checklist_item")
    .update({ status: "attached" })
    .eq("requirement_id", req!.id)
    .eq("is_mandatory", true);

  // T5.2 · Create from requirement, then satisfy the line
  const versionId = await owner.rpc("create_quotation_from_requirement", {
    p_requirement_id: req!.id,
    p_line_ids: [line!.id],
  });
  record(
    "T5.2 create_quotation_from_requirement creates a draft version with lines",
    !versionId.error && Boolean(versionId.data),
    versionId.error?.message ?? "ok",
  );
  const v = versionId.data as string;

  await owner
    .from("quotation_line")
    .update({ unit_cost: 60, proposed_unit_price: 100, sourcing_basis: "in_house" })
    .eq("quotation_version_id", v);

  const gates = await owner.rpc("quotation_gate_errors", { p_version_id: v });
  record(
    "T5.2 The gate is clear once coverage, checklist, price and basis are set",
    !gates.error && (gates.data as string[]).length === 0,
    gates.error?.message ?? JSON.stringify(gates.data),
  );

  // T5.3 · Submit and approve
  const submit = await sales.rpc("submit_quote_for_approval", { p_version_id: v });
  const afterSubmit = await admin
    .from("quotation_version")
    .select("status, approval_id")
    .eq("id", v)
    .single();
  record(
    "T5.3 Submit sets pending_approval and creates an approval",
    !submit.error && afterSubmit.data?.status === "pending_approval" && Boolean(afterSubmit.data?.approval_id),
    submit.error?.message ?? `status ${afterSubmit.data?.status}`,
  );

  const salesApprove = await sales.rpc("approve_quotation_version", {
    p_version_id: v,
    p_comment: "sales trying to approve",
  });
  record(
    "T5.3 Sales cannot approve the quotation",
    Boolean(salesApprove.error) && /FORBIDDEN/.test(salesApprove.error?.message ?? ""),
    salesApprove.error ? salesApprove.error.message.split("\n")[0] : "sales approved",
  );

  const ownerApprove = await owner.rpc("approve_quotation_version", {
    p_version_id: v,
    p_comment: "Approved by Owner (E2E)",
  });
  const approved = await admin
    .from("quotation_version")
    .select("status, snapshot")
    .eq("id", v)
    .single();
  record(
    "T5.3 Owner approval locks the version and snapshots totals",
    !ownerApprove.error && approved.data?.status === "approved" && approved.data?.snapshot !== null,
    ownerApprove.error?.message ?? `status ${approved.data?.status}`,
  );

  // Approved lines are immutable.
  const editAfterApprove = await owner
    .from("quotation_line")
    .update({ proposed_unit_price: 110 })
    .eq("quotation_version_id", v);
  record(
    "T5.3 An approved line cannot be edited (BR-19)",
    Boolean(editAfterApprove.error) && /BR-19/.test(editAfterApprove.error?.message ?? ""),
    editAfterApprove.error?.message.split("\n")[0] ?? "edit allowed",
  );

  // T5.6 · Submission: late reason required, then accepted
  await admin
    .from("requirement")
    .update({ submission_deadline: iso(new Date(Date.now() - 86400000)) })
    .eq("id", req!.id);
  const lateNo = await sales.rpc("record_quotation_submission", {
    p_version_id: v,
    p_mode: "email",
    p_at: iso(new Date()),
    p_ref: "E2E-REF",
    p_proof_document_id: null,
    p_late_reason: null,
  });
  record(
    "T5.6 A late submission without a reason is rejected",
    Boolean(lateNo.error) && /FR-QUOTE-07/.test(lateNo.error?.message ?? ""),
    lateNo.error?.message.split("\n")[0] ?? "late submission allowed",
  );
  const submitRecord = await sales.rpc("record_quotation_submission", {
    p_version_id: v,
    p_mode: "email",
    p_at: iso(new Date()),
    p_ref: "E2E-REF",
    p_proof_document_id: null,
    p_late_reason: "Customer extended the deadline orally",
  });
  const submitted = await admin
    .from("quotation_version")
    .select("status, submission_ref")
    .eq("id", v)
    .single();
  record(
    "T5.6 Recording a submission marks the version submitted",
    !submitRecord.error && submitted.data?.status === "submitted",
    submitRecord.error?.message ?? `status ${submitted.data?.status}`,
  );

  // T5.4 · Revision copies lines into a new draft
  const revision = await sales.rpc("create_revision", {
    p_version_id: v,
    p_reason: "revised",
  });
  const revLines = revision.data
    ? await admin
        .from("quotation_line")
        .select("id", { count: "exact", head: true })
        .eq("quotation_version_id", revision.data as string)
    : { count: 0 };
  const revVersion = revision.data
    ? await admin
        .from("quotation_version")
        .select("version_no, status, version_reason")
        .eq("id", revision.data as string)
        .single()
    : { data: null };
  record(
    "T5.4 create_revision makes a new draft with copied lines",
    !revision.error &&
      revVersion.data?.status === "draft" &&
      revVersion.data?.version_no === 2 &&
      revVersion.data?.version_reason === "revised" &&
      (revLines.count ?? 0) === 1,
    revision.error?.message ?? `v${revVersion.data?.version_no} ${revVersion.data?.status}`,
  );

  // T5.5 · Bid history and view log
  const history = await owner
    .from("v_bid_history")
    .select("quotation_line_id, requirement_id")
    .eq("requirement_id", req!.id);
  const ownerMarginHistory = await owner
    .from("v_bid_history_with_margin")
    .select("quotation_line_id, margin_pct")
    .eq("requirement_id", req!.id);
  const opsMarginHistory = await operations
    .from("v_bid_history_with_margin")
    .select("quotation_line_id")
    .eq("requirement_id", req!.id);
  record(
    "T5.5 Bid history exists; margin is hidden from Operations",
    (history.data?.length ?? 0) >= 1 &&
      (ownerMarginHistory.data?.length ?? 0) >= 1 &&
      (opsMarginHistory.data?.length ?? -1) === 0,
    `history ${history.data?.length ?? 0}, owner margin ${ownerMarginHistory.data?.length ?? 0}, ops margin ${opsMarginHistory.data?.length ?? "err"}`,
  );

  await owner.rpc("log_history_view", { p_line_id: line!.id });
  const log = await admin
    .from("history_view_log")
    .select("id", { count: "exact", head: true })
    .eq("line_id", line!.id);
  record(
    "T5.5 Viewing comparable history is logged",
    (log.count ?? 0) >= 1,
    `${log.count ?? 0} log row(s)`,
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
