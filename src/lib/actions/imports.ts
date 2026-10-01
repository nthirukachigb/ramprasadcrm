"use server";

import { revalidatePath } from "next/cache";

import { requireRole } from "@/lib/auth/get-user";
import { createClient } from "@/lib/supabase/server";

export async function requestImportSignoff(batchId: string) {
  await requireRole(["admin", "owner"]);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_approval", {
    p_subject_type: "import_batch",
    p_subject_id: batchId,
    p_reason: "Review validated synthetic import batch before commit",
  });
  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/imports");
  return { ok: true as const, approvalId: data as string };
}

export async function commitImportBatch(batchId: string) {
  await requireRole(["admin", "owner"]);
  const supabase = await createClient();
  const { data, error } = await supabase.schema("app").rpc("commit_import_batch", { p_batch_id: batchId });
  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/imports");
  return { ok: true as const, result: data as { committed_rows?: number } };
}

export async function rollbackImportBatch(batchId: string) {
  await requireRole(["admin", "owner"]);
  const supabase = await createClient();
  const { data, error } = await supabase.schema("app").rpc("rollback_import_batch", { p_batch_id: batchId });
  if (error) return { ok: false as const, error: error.message };
  revalidatePath("/imports");
  return { ok: true as const, result: data as { rolled_back?: boolean } };
}
