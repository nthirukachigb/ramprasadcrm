import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET(request: Request) {
  await requireRole(["owner", "admin"]);
  const url = new URL(request.url);
  const supabase = await createClient();
  let query = supabase
    .from("v_audit_event")
    .select("id, table_name, record_id, action, actor_name, occurred_at, reason")
    .order("occurred_at", { ascending: false })
    .limit(5000);

  const table = url.searchParams.get("table");
  const record = url.searchParams.get("record");
  const actor = url.searchParams.get("actor");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (table) query = query.ilike("table_name", `%${table}%`);
  if (record) query = query.ilike("record_id", `%${record}%`);
  if (actor) query = query.eq("actor", actor);
  if (from) query = query.gte("occurred_at", `${from}T00:00:00Z`);
  if (to) query = query.lt("occurred_at", `${to}T00:00:00Z`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "Audit export unavailable" }, { status: 500 });

  await supabase.rpc("log_access", {
    p_action: "EXPORT",
    p_entity_type: "audit_events",
    p_entity_id: null,
    p_metadata: { filters: Object.fromEntries(url.searchParams), row_count: data?.length ?? 0 },
  });

  const header = ["id", "table", "record_id", "action", "actor_name", "occurred_at", "reason"];
  const lines = [header, ...(data ?? []).map((row) => [row.id, row.table_name, row.record_id, row.action, row.actor_name, row.occurred_at, row.reason])]
    .map((row) => row.map(csvCell).join(","));
  return new NextResponse(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"audit-events.csv\"",
      "Cache-Control": "no-store",
    },
  });
}