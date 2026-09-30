/**
 * Seed synthetic Phase 2 requirement data (requirements, lines, a clarification).
 *
 *   npm run seed:requirements
 *
 * Synthetic data only. Idempotent: requirements are keyed by customer_reference.
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(file);
    } catch {
      // Missing file — fall back to the real environment.
    }
  }
}

async function upsertRequirement(
  supabase: SupabaseClient,
  customerId: string,
  input: {
    reference: string;
    type: string;
    status: string;
    project: string;
    channel: string;
    lines: {
      description: string;
      quantity: number;
      uom: string;
      customerPart: string;
    }[];
  },
): Promise<string> {
  const { data: existing } = await supabase
    .from("requirement")
    .select("id")
    .eq("customer_reference", input.reference)
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id as string;

  const { data: requirement, error } = await supabase
    .from("requirement")
    .insert({
      requirement_type: input.type,
      customer_id: customerId,
      source_channel: input.channel,
      customer_reference: input.reference,
      project_name: input.project,
      status: input.status,
      enquiry_date: new Date().toISOString().slice(0, 10),
      deadline_tbc: false,
      submission_deadline: new Date(Date.now() + 10 * 86400000).toISOString(),
    })
    .select("id")
    .single();
  if (error || !requirement) {
    throw new Error(`Failed to create requirement ${input.reference}: ${error?.message}`);
  }

  const lines = input.lines.map((line, index) => ({
    requirement_id: requirement.id,
    line_no: index + 1,
    description: line.description,
    customer_part_no: line.customerPart,
    quantity_required: line.quantity,
    uom: line.uom,
  }));
  const { error: lineError } = await supabase.from("requirement_line").insert(lines);
  if (lineError) {
    throw new Error(`Failed to create lines for ${input.reference}: ${lineError.message}`);
  }

  return requirement.id as string;
}

async function main() {
  loadEnv();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.",
    );
  }
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: customer } = await supabase
    .from("customer")
    .select("id, name")
    .order("name", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!customer) {
    throw new Error("No customer found. Run npm run seed:masters first.");
  }

  await upsertRequirement(supabase, customer.id, {
    reference: "SYN-ENQ-001",
    type: "enquiry",
    status: "received",
    project: "Synthetic radar spares enquiry",
    channel: "email",
    lines: [
      { description: "Synthetic waveguide assembly", quantity: 12, uom: "NO", customerPart: "SYN-RAD-001" },
      { description: "Synthetic coaxial connector", quantity: 40, uom: "NO", customerPart: "SYN-RAD-002" },
      { description: "Synthetic mounting bracket", quantity: 8, uom: "NO", customerPart: "SYN-RAD-003" },
    ],
  });

  const inPrepId = await upsertRequirement(supabase, customer.id, {
    reference: "SYN-ENQ-002",
    type: "rfq",
    status: "in_preparation",
    project: "Synthetic power supply RFQ",
    channel: "gem",
    lines: [
      { description: "Synthetic 24V power supply", quantity: 25, uom: "NO", customerPart: "SYN-PWR-101" },
      { description: "Synthetic power cable harness", quantity: 25, uom: "NO", customerPart: "SYN-PWR-102" },
      { description: "Synthetic fuse unit", quantity: 60, uom: "NO", customerPart: "SYN-PWR-103" },
      { description: "Synthetic filter module", quantity: 15, uom: "NO", customerPart: "SYN-PWR-104" },
      { description: "Synthetic enclosure", quantity: 10, uom: "NO", customerPart: "SYN-PWR-105" },
    ],
  });

  await upsertRequirement(supabase, customer.id, {
    reference: "SYN-TND-003",
    type: "tender",
    status: "quoted",
    project: "Synthetic tender for cable assemblies",
    channel: "buyer_portal",
    lines: [
      { description: "Synthetic cable assembly A", quantity: 100, uom: "NO", customerPart: "SYN-CBL-201" },
      { description: "Synthetic cable assembly B", quantity: 150, uom: "NO", customerPart: "SYN-CBL-202" },
    ],
  });

  // One clarification on the in-preparation requirement.
  const { data: existingClarification } = await supabase
    .from("clarification")
    .select("id")
    .eq("requirement_id", inPrepId)
    .eq("subject", "Synthetic missing drawing")
    .maybeSingle();
  if (!existingClarification) {
    await supabase.from("clarification").insert({
      requirement_id: inPrepId,
      clarification_type: "missing_drawing",
      subject: "Synthetic missing drawing",
      detail: "The customer has not supplied the enclosure drawing.",
      due_date: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
    });
  }

  console.log("Seeded synthetic Phase 2 requirements.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
