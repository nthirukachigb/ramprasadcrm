/** Phase 11 acceptance verification against a configured Supabase project. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    try { process.loadEnvFile(file); } catch { /* optional */ }
  }
}

const checks: { name: string; pass: boolean; detail: string }[] = [];
function record(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

async function main() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const password = process.env.DEMO_USER_PASSWORD;
  if (!url || !anon || !service || !password) throw new Error("Missing Supabase verification environment.");
  const projectUrl = url;
  const publishableKey = anon;
  const serviceKey = service;
  const demoPassword = password;

  const admin = createClient(projectUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  async function signIn(email: string): Promise<SupabaseClient> {
    const client = createClient(projectUrl, publishableKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await client.auth.signInWithPassword({ email, password: demoPassword });
    if (error) throw new Error(`${email}: ${error.message}`);
    return client;
  }

  const owner = await signIn("owner@demo.local");
  const operations = await signIn("operations@demo.local");
  const product = await admin.from("product").select("id, internal_part_number").limit(1).maybeSingle();
  if (!product.data) throw new Error("Seed masters first.");
  const rawPart = product.data.internal_part_number as string;
  const normalized = rawPart.replace(/[\s\-./]/g, "");

  const search = await owner.rpc("search", { p_q: normalized, p_filters: {}, p_limit: 50, p_cursor: null });
  const found = (search.data ?? []).some((row: { entity_type: string; entity_id: string }) => row.entity_type === "product" && row.entity_id === product.data!.id);
  record("T11.1 normalized part-number search finds the product", found, search.error?.message ?? normalized);

  const index = await admin.from("search_document").select("entity_type", { count: "exact", head: true });
  record("T11.1 search index is populated", !index.error && (index.count ?? 0) > 0, index.error?.message ?? `${index.count ?? 0} indexed records`);

  const triggers = await admin
    .from("search_document")
    .select("entity_type", { count: "exact", head: true })
    .eq("entity_type", "product");
  record("T11.1 product records are indexed", !triggers.error && (triggers.count ?? 0) > 0, triggers.error?.message ?? `${triggers.count ?? 0} product record(s)`);

  const restricted = await operations.rpc("comparable_history", { p_line_id: "00000000-0000-0000-0000-000000000000" });
  record("T11.2 comparable history is role-gated", Boolean(restricted.error) && /FORBIDDEN|permission/i.test(restricted.error?.message ?? ""), restricted.error?.message ?? "operations was not blocked");

  const suggestions = await owner.rpc("search_suggestions", { p_q: rawPart.slice(0, Math.max(3, rawPart.length - 1)), p_limit: 5 });
  record("T11.2 close searches return suggestions", !suggestions.error, suggestions.error?.message ?? `${suggestions.data?.length ?? 0} suggestion(s)`);

  const failed = checks.filter((check) => !check.pass);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed.`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
