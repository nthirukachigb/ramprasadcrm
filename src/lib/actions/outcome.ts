"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser, type AppRole } from "@/lib/auth/get-user";
import { friendlyError } from "@/lib/actions/errors";
import { createClient } from "@/lib/supabase/server";

const WRITE_ROLES: AppRole[] = ["owner", "sales", "operations", "admin"];

export type OutcomeResult = { ok: true } | { ok: false; error: string };

export interface LineOutcomeInput {
  quotationVersionId: string;
  requirementLineId: string;
  outcome: "won" | "partially_won" | "lost" | "not_pursued" | "cancelled";
  qtyWon: number;
  qtyLost: number;
  lossReasonCode?: string | null;
  lossReasonOther?: string | null;
  competitorPartnerId?: string | null;
  winningPrice?: number | null;
  lPosition?: string | null;
  notes?: string | null;
}

export async function saveLineOutcomes(input: {
  versionId: string;
  rows: LineOutcomeInput[];
}): Promise<OutcomeResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (!user.roles.some((role) => WRITE_ROLES.includes(role))) {
    return { ok: false, error: "You do not have permission to record outcomes." };
  }
  if (input.rows.length === 0) return { ok: false, error: "No outcomes to save." };

  const supabase = await createClient();
  const { error } = await supabase.from("line_outcome").upsert(
    input.rows.map((row) => ({
      quotation_version_id: row.quotationVersionId,
      requirement_line_id: row.requirementLineId,
      outcome: row.outcome,
      qty_won: row.qtyWon,
      qty_lost: row.qtyLost,
      loss_reason_code: row.lossReasonCode ?? null,
      loss_reason_other: row.lossReasonOther ?? null,
      competitor_partner_id: row.competitorPartnerId ?? null,
      winning_price: row.winningPrice ?? null,
      l_position: row.lPosition ?? null,
      notes: row.notes ?? null,
    })),
    { onConflict: "quotation_version_id,requirement_line_id" },
  );
  if (error) return { ok: false, error: friendlyError(error.message, error.code) };

  revalidatePath(`/quotations/${input.versionId}/outcome`);
  revalidatePath(`/quotations/${input.versionId}`);
  revalidatePath("/dashboard");
  return { ok: true };
}
