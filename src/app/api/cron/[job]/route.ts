import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * Vercel Cron fallback for the scheduled jobs (T6.3). Guarded by CRON_SECRET.
 * Configure in vercel.json: { "crons": [{ "path": "/api/cron/<job>", "schedule": "..." }] }.
 */
async function handle(
  request: Request,
  { params }: { params: Promise<{ job: string }> },
) {
  const secret = process.env.CRON_SECRET;
  const provided = request.headers.get("authorization");
  if (secret && provided !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { job } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.rpc("run_job", {
    p_job: job,
    p_triggered_by: "cron",
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ job, created: data });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ job: string }> },
) {
  return handle(request, context);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ job: string }> },
) {
  return handle(request, context);
}
