/**
 * Phase 3 acceptance verification (T3.1) against a live Supabase project.
 *
 *   npm run verify:phase3
 *
 * Requires the Phase 3 migrations applied and seeded demo users. Exits non-zero
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

  const customer = await admin.from("customer").select("id").limit(1).maybeSingle();
  const partner = await admin.from("partner").select("id").limit(1).maybeSingle();
  if (!customer.data || !partner.data) {
    throw new Error("Seed masters first (npm run seed:masters).");
  }

  // Fixture: requirement + line.
  const { data: req, error: reqError } = await admin
    .from("requirement")
    .insert({
      requirement_type: "enquiry",
      customer_id: customer.data.id,
      source_channel: "email",
      customer_reference: `VERIFY-P3-${Date.now()}`,
      enquiry_date: new Date().toISOString().slice(0, 10),
    })
    .select("id")
    .single();
  if (reqError) throw new Error(reqError.message);

  const { data: line, error: lineError } = await admin
    .from("requirement_line")
    .insert({
      requirement_id: req.id,
      line_no: 1,
      description: "Verify sourcing line",
      quantity_required: 1000,
      uom: "NO",
    })
    .select("id")
    .single();
  if (lineError) throw new Error(lineError.message);

  // 1. Commitment without evidence rejected --------------------------------
  const noEvidence = await owner.from("quantity_commitment").insert({
    requirement_line_id: line.id,
    partner_id: partner.data.id,
    qty_committed: 500,
  });
  record(
    "A commitment without evidence is rejected",
    Boolean(noEvidence.error) && noEvidence.error?.code === "23514",
    noEvidence.error ? `code ${noEvidence.error.code}` : "commitment was allowed",
  );

  // 2. Commitment with evidence accepted -----------------------------------
  const withEvidence = await owner
    .from("quantity_commitment")
    .insert({
      requirement_line_id: line.id,
      partner_id: partner.data.id,
      qty_committed: 1000,
      evidence_note: "Email confirmation reference VERIFY-1",
    })
    .select("id, version, status")
    .single();
  record(
    "A commitment with evidence is accepted at version 1",
    !withEvidence.error && withEvidence.data?.version === 1,
    withEvidence.error ? withEvidence.error.message : `version ${withEvidence.data?.version}`,
  );

  const commitmentId = withEvidence.data!.id;

  // 3. In-place quantity edit blocked --------------------------------------
  const inPlace = await owner
    .from("quantity_commitment")
    .update({ qty_committed: 600 })
    .eq("id", commitmentId);
  record(
    "An in-place quantity edit is blocked",
    Boolean(inPlace.error) &&
      /COMMITMENT_VERSION_REQUIRED/.test(inPlace.error?.message ?? ""),
    inPlace.error ? inPlace.error.message.split("\n")[0] : "in-place edit allowed",
  );

  // 4. change_commitment creates a new active version -----------------------
  const newId = await owner.rpc("change_commitment", {
    p_id: commitmentId,
    p_new_qty: 600,
    p_reason: "OEM reduced firm quantity",
  });
  const oldRow = await admin
    .from("quantity_commitment")
    .select("status")
    .eq("id", commitmentId)
    .single();
  const newRow = newId.data
    ? await admin
        .from("quantity_commitment")
        .select("version, status, qty_committed, supersedes_id")
        .eq("id", newId.data as string)
        .single()
    : { data: null };
  record(
    "change_commitment versions the row and marks the old one changed",
    !newId.error &&
      oldRow.data?.status === "changed" &&
      newRow.data?.version === 2 &&
      newRow.data?.status === "active" &&
      Number(newRow.data?.qty_committed) === 600 &&
      newRow.data?.supersedes_id === commitmentId,
    newId.error ? newId.error.message.split("\n")[0] : `v2 active, old changed`,
  );

  // 5. committed_qty and withdrawal ----------------------------------------
  const before = await owner.rpc("committed_qty", {
    p_requirement_line_id: line.id,
  });
  await owner.rpc("withdraw_commitment", {
    p_id: newId.data as string,
    p_reason: "OEM withdrew the commitment",
  });
  const after = await owner.rpc("committed_qty", {
    p_requirement_line_id: line.id,
  });
  record(
    "Withdrawing reduces the firm committed quantity",
    Number(before.data) === 600 && Number(after.data) === 0,
    `before ${before.data}, after ${after.data}`,
  );

  // 6. Selection above firm commitment blocked ------------------------------
  const overAllocate = await owner.from("oem_selection").insert({
    requirement_line_id: line.id,
    partner_id: partner.data.id,
    qty_allocated: 100,
  });
  record(
    "Allocating above the firm commitment is blocked",
    Boolean(overAllocate.error) &&
      /SELECTION_EXCEEDS_COMMITMENT/.test(overAllocate.error?.message ?? ""),
    overAllocate.error ? overAllocate.error.message.split("\n")[0] : "allocation allowed",
  );

  // 7. Approved selection without an approval record rejected ---------------
  const { data: commitment2 } = await admin
    .from("quantity_commitment")
    .insert({
      requirement_line_id: line.id,
      partner_id: partner.data.id,
      qty_committed: 100,
      evidence_note: "Second commitment for selection check",
    })
    .select("id")
    .single();
  const selection = await admin
    .from("oem_selection")
    .insert({
      requirement_line_id: line.id,
      partner_id: partner.data.id,
      qty_allocated: 100,
    })
    .select("id")
    .single();
  const approveWithout = await admin
    .from("oem_selection")
    .update({ status: "approved" })
    .eq("id", selection.data!.id);
  record(
    "An approved selection needs an approval record",
    !commitment2 ? false : Boolean(approveWithout.error) && approveWithout.error?.code === "23514",
    approveWithout.error ? `code ${approveWithout.error.code}` : "approved without approval",
  );

  // 8. suggest_partners is read-only and returns without error --------------
  const suggestion = await owner.rpc("suggest_partners", {
    p_requirement_id: req.id,
  });
  record(
    "suggest_partners returns without error (read-only suggestion)",
    !suggestion.error,
    suggestion.error ? suggestion.error.message.split("\n")[0] : `${suggestion.data?.length ?? 0} candidate(s)`,
  );

  // 9. Anonymous access blocked --------------------------------------------
  const anonClient = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anonRead = await anonClient.from("quantity_commitment").select("id");
  record(
    "Unauthenticated access to commitments is blocked by RLS",
    (anonRead.data?.length ?? 0) === 0,
    `anonymous rows: ${anonRead.data?.length ?? 0}`,
  );

  // Cleanup
  await admin.from("requirement").delete().eq("id", req.id);

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
