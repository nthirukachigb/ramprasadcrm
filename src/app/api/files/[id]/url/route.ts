import { NextResponse } from "next/server";

import { getDocumentSignedUrl } from "@/lib/actions/documents";
import { signedUrlTtlSeconds } from "@/lib/platform/storage";

export const dynamic = "force-dynamic";

/**
 * Returns a short-lived signed download URL after an RLS-checked read, and
 * writes an access_log row (T2.5, FR-SEC-03).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await getDocumentSignedUrl(id);

  if (!result.ok) {
    const status = result.error === "Unauthorized" ? 401 : 404;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({
    url: result.url,
    expiresIn: signedUrlTtlSeconds(),
  });
}
