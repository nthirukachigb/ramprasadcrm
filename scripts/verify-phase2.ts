/**
 * Phase 2 acceptance verification against a live Supabase project.
 *
 *   npm run verify:phase2
 *
 * Requires the same env as the seed scripts, plus seeded demo users, and the
 * Phase 2 migrations applied. Asserts the Phase 2 acceptance criteria and
 * prints a PASS/FAIL report. Exits non-zero if any check fails.
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

const createdRequirements: string[] = [];

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

  const customer = await admin
    .from("customer")
    .select("id, name")
    .limit(1)
    .maybeSingle();
  if (!customer.data) throw new Error("No customer found. Run seed:masters.");

  async function createRequirement(reference: string) {
    const { data, error } = await admin
      .from("requirement")
      .insert({
        requirement_type: "enquiry",
        customer_id: customer.data!.id,
        source_channel: "email",
        customer_reference: reference,
        enquiry_date: new Date().toISOString().slice(0, 10),
      })
      .select("id, internal_ref")
      .single();
    if (error) throw new Error(`create requirement: ${error.message}`);
    createdRequirements.push(data.id);
    return { ...(data as { id: string; internal_ref: string }), reference };
  }

  // 1. Automatic numbering (FR-RFI-03) -------------------------------------
  const first = await createRequirement(`VERIFY-P2-${Date.now()}-A`);
  const second = await createRequirement(`VERIFY-P2-${Date.now()}-B`);
  const pattern = /^RQ\/\d{2}-\d{2}\/\d{4}$/;
  record(
    "Automatic numbering generates unique RQ references",
    pattern.test(first.internal_ref) &&
      pattern.test(second.internal_ref) &&
      first.internal_ref !== second.internal_ref,
    `${first.internal_ref}, ${second.internal_ref}`,
  );

  // 2. Line limit: 500 allowed, 501st blocked (FR-RFI-02) -------------------
  const target = await createRequirement(`VERIFY-P2-LINES-${Date.now()}`);
  const rows = Array.from({ length: 500 }, (_, index) => ({
    requirement_id: target.id,
    line_no: index + 1,
    description: `Verify line ${index + 1}`,
    quantity_required: 1,
    uom: "NO",
  }));
  const bulk = await admin.from("requirement_line").insert(rows);
  const over = await admin.from("requirement_line").insert({
    requirement_id: target.id,
    line_no: 501,
    description: "501st line",
    quantity_required: 1,
    uom: "NO",
  });
  record(
    "The 501st line is blocked by FR-RFI-02",
    !bulk.error &&
      Boolean(over.error) &&
      /FR-RFI-02/.test(over.error?.message ?? ""),
    over.error ? over.error.message.split("\n")[0] : "501st line was allowed",
  );

  // 3. Invalid status jump rejected (BR-30) --------------------------------
  const jump = await owner.rpc("transition_requirement", {
    p_id: first.id,
    p_to_status: "submitted",
    p_reason: "verify invalid jump",
  });
  record(
    "An invalid status jump is rejected",
    Boolean(jump.error) && /BR-30/.test(jump.error?.message ?? ""),
    jump.error ? jump.error.message.split("\n")[0] : "jump was allowed",
  );

  // 4. Pass requires Owner approval (BR-14) --------------------------------
  const passWithoutApproval = await sales.rpc("transition_requirement", {
    p_id: first.id,
    p_to_status: "not_pursued",
    p_reason: "Not a fit",
  });
  record(
    "Pass without Owner approval is blocked",
    Boolean(passWithoutApproval.error) &&
      /BR-14/.test(passWithoutApproval.error?.message ?? ""),
    passWithoutApproval.error
      ? passWithoutApproval.error.message.split("\n")[0]
      : "pass was allowed without approval",
  );

  // 5. Sales cannot decide an approval; Owner can --------------------------
  const requested = await sales.rpc("request_approval", {
    p_subject_type: "requirement",
    p_subject_id: first.id,
    p_reason: "Not a fit for our capability",
  });
  const salesDecide = requested.data
    ? await sales.rpc("decide_approval", {
        p_approval_id: requested.data as string,
        p_decision: "approved",
        p_comment: "trying to approve",
      })
    : { error: { message: "no approval created" } };
  record(
    "Sales cannot decide an approval; Owner can",
    Boolean(salesDecide.error) &&
      Boolean(requested.data) &&
      !(
        await owner.rpc("decide_approval", {
          p_approval_id: requested.data as string,
          p_decision: "approved",
          p_comment: "Approved by Owner for verification",
        })
      ).error,
    salesDecide.error ? salesDecide.error.message.split("\n")[0] : "sales decided",
  );

  const passAfterApproval = await sales.rpc("transition_requirement", {
    p_id: first.id,
    p_to_status: "not_pursued",
    p_reason: "Not a fit for our capability",
  });
  record(
    "Pass succeeds after Owner approval",
    !passAfterApproval.error,
    passAfterApproval.error
      ? passAfterApproval.error.message.split("\n")[0]
      : "transition to Not pursued recorded",
  );

  // 6. Duplicate customer reference warning ---------------------------------
  const dupRequirement = await createRequirement(target.reference);
  const dup = await owner.rpc("requirement_duplicate_customer_ref", {
    p_customer_id: customer.data.id,
    p_customer_reference: target.reference,
    p_exclude_id: dupRequirement.id,
  });
  record(
    "Duplicate customer + reference warning returns the other requirement",
    !dup.error && (dup.data?.length ?? 0) === 1,
    dup.error ? dup.error.message.split("\n")[0] : `${dup.data?.length ?? 0} match(es)`,
  );

  // 7. Checklist seeded on requirement creation ----------------------------
  const checklist = await admin
    .from("checklist_item")
    .select("id, is_mandatory", { count: "exact" })
    .eq("requirement_id", target.id);
  record(
    "Tender checklist is created with the requirement",
    (checklist.data?.length ?? 0) >= 5,
    `${checklist.data?.length ?? 0} checklist item(s)`,
  );

  // 8. Dashboard tile count = drill-down count ------------------------------
  const tile = await owner
    .from("v_tile_d01")
    .select("requirement_id");
  const kpi = await owner
    .from("v_dashboard_kpis")
    .select("count_value")
    .eq("tile_code", "D-01")
    .maybeSingle();
  record(
    "Tile D-01 count equals its drill-down rows",
    (kpi.data?.count_value ?? -1) === (tile.data?.length ?? -2),
    `tile ${kpi.data?.count_value ?? "n/a"}, rows ${tile.data?.length ?? "n/a"}`,
  );

  // 9. Unauthenticated access blocked --------------------------------------
  const anonClient = createClient(url, anon, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anonRead = await anonClient.from("requirement").select("id");
  record(
    "Unauthenticated access to requirements is blocked by RLS",
    (anonRead.data?.length ?? 0) === 0,
    `anonymous rows: ${anonRead.data?.length ?? 0}`,
  );

  // 10. Durability ----------------------------------------------------------
  const persisted = await admin
    .from("requirement")
    .select("id", { count: "exact", head: true });
  record(
    "Requirement data persists (durability)",
    (persisted.count ?? 0) >= 3,
    `${persisted.count ?? 0} requirements stored`,
  );

  // Cleanup -----------------------------------------------------------------
  if (createdRequirements.length > 0) {
    await admin.from("requirement").delete().in("id", createdRequirements);
  }

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
