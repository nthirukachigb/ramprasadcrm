"use server";

import { revalidatePath } from "next/cache";

import { getCurrentUser, type AppRole } from "@/lib/auth/get-user";
import { friendlyError } from "@/lib/actions/errors";
import { saveLinesSchema } from "@/lib/schemas/requirement";
import { createClient } from "@/lib/supabase/server";

const WRITE_ROLES: AppRole[] = ["owner", "sales", "operations", "admin"];

export interface RowError {
  line_no: number | null;
  error: string;
}

export type SaveLinesResult =
  | { ok: true; saved: number; total: number; errors: RowError[] }
  | { ok: false; error: string };

export async function saveRequirementLines(
  input: unknown,
): Promise<SaveLinesResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Please sign in again." };
  if (!user.roles.some((role) => WRITE_ROLES.includes(role))) {
    return { ok: false, error: "You do not have permission to edit lines." };
  }

  const parsed = saveLinesSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Please check the lines.",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("upsert_requirement_lines", {
    p_requirement_id: parsed.data.requirementId,
    p_lines: parsed.data.lines,
  });

  if (error) return { ok: false, error: friendlyError(error.message, error.code) };

  const result = (data ?? {}) as {
    saved?: number;
    total?: number;
    errors?: RowError[];
  };

  revalidatePath(`/requirements/${parsed.data.requirementId}`);
  revalidatePath(`/requirements/${parsed.data.requirementId}/lines`);
  revalidatePath("/dashboard");

  return {
    ok: true,
    saved: result.saved ?? 0,
    total: result.total ?? 0,
    errors: result.errors ?? [],
  };
}

export interface ProductMatch {
  productId: string;
  internalPartNumber: string;
  description: string;
  uom: string;
}

/**
 * Match requirement lines against the product master by normalised part number
 * (internal or cross-referenced). Read-only; used to fill product_id on save.
 */
export async function matchProducts(
  partNumbers: string[],
): Promise<Record<string, ProductMatch>> {
  const cleaned = Array.from(
    new Set(
      partNumbers
        .map((value) => value.trim().toLowerCase().replace(/\s+/g, " "))
        .filter((value) => value.length > 0),
    ),
  );
  if (cleaned.length === 0) return {};

  const supabase = await createClient();
  const matches: Record<string, ProductMatch> = {};

  const { data: products } = await supabase
    .from("product")
    .select("id, internal_part_number, internal_part_number_normalized, description, uom")
    .in("internal_part_number_normalized", cleaned);

  for (const row of products ?? []) {
    matches[row.internal_part_number_normalized as string] = {
      productId: row.id,
      internalPartNumber: row.internal_part_number,
      description: row.description,
      uom: row.uom,
    };
  }

  const { data: partNumbersRows } = await supabase
    .from("part_number")
    .select("value_normalized, product_id")
    .in("value_normalized", cleaned);

  const missingProductIds = Array.from(
    new Set(
      (partNumbersRows ?? [])
        .map((row) => row.product_id as string)
        .filter((id) => !Object.values(matches).some((m) => m.productId === id)),
    ),
  );

  if (missingProductIds.length > 0) {
    const { data: missingProducts } = await supabase
      .from("product")
      .select("id, internal_part_number, description, uom")
      .in("id", missingProductIds);
    for (const row of missingProducts ?? []) {
      for (const match of partNumbersRows ?? []) {
        if (match.product_id === row.id) {
          matches[match.value_normalized as string] = {
            productId: row.id,
            internalPartNumber: row.internal_part_number,
            description: row.description,
            uom: row.uom,
          };
        }
      }
    }
  }

  return matches;
}
