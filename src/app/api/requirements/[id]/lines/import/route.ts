import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/get-user";
import { detectHeaderRow } from "@/lib/import/header-detect";
import { parseWorkbook } from "@/lib/import/parse";
import { getImportTemplate } from "@/lib/import/templates";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  await requireRole(["owner", "sales", "operations", "admin"]);
  const { id: requirementId } = await context.params;
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Choose a workbook." }, { status: 400 });

  try {
    const parsed = parseWorkbook(new Uint8Array(await file.arrayBuffer()), file.name);
    const sheetName = parsed.sheets[0]?.sheet;
    const sheetRows = parsed.sheets.filter((row) => row.sheet === sheetName);
    const template = getImportTemplate("LINES_GENERIC");
    if (!template) throw new Error("Line template is unavailable.");
    const values = sheetRows.map((row) => Object.values(row.cells).map((cell) => cell.value));
    const header = detectHeaderRow(values, { synonyms: template.synonyms });
    if (!header) throw new Error("No line-item header was found in the first 15 rows.");

    const errors: { row: number; message: string }[] = [];
    const lines = sheetRows.slice(header.rowNumber).flatMap((row) => {
      const cells = Object.values(row.cells).map((cell) => cell.value);
      if (cells.every((cell) => String(cell ?? "").trim() === "")) return [];
      const mapped: Record<string, unknown> = {};
      Object.entries(header.mappings).forEach(([column, field]) => { mapped[field] = cells[Number(column)]; });
      const quantity = Number(String(mapped.quantity ?? "").replace(/,/g, ""));
      const description = String(mapped.description ?? "").trim();
      const uom = String(mapped.uom ?? "").trim();
      if (!description || !Number.isFinite(quantity) || quantity <= 0 || !uom) {
        errors.push({ row: row.rowNumber, message: `${!description ? "description is required; " : ""}${!Number.isFinite(quantity) || quantity <= 0 ? "quantity must be positive; " : ""}${!uom ? "UoM is required" : ""}`.replace(/; $/, "") });
        return [];
      }
      return [{
        line_no: 0,
        customer_part_no: String(mapped.partNumber ?? "").trim() || undefined,
        internal_part_no: String(mapped.partNumber ?? "").trim() || undefined,
        description,
        quantity_required: quantity,
        uom,
        specification_ref: String(mapped.specificationRef ?? "").trim() || undefined,
        approval_types_required: [],
      }];
    });
    if (lines.length > 500) return NextResponse.json({ error: "A requirement can hold at most 500 lines.", errors }, { status: 422 });
    const numbered = lines.map((line, index) => ({ ...line, line_no: index + 1 }));
    if (numbered.length > 0) {
      const supabase = await createClient();
      const { data, error } = await supabase.rpc("upsert_requirement_lines", { p_requirement_id: requirementId, p_lines: numbered });
      if (error) return NextResponse.json({ error: error.message, errors }, { status: 422 });
      return NextResponse.json({ saved: (data as { saved?: number } | null)?.saved ?? numbered.length, errors });
    }
    return NextResponse.json({ saved: 0, errors });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Line import failed." }, { status: 422 });
  }
}
