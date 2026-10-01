import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { detectHeaderRow } from "@/lib/import/header-detect";
import { getImportTemplate } from "@/lib/import/templates";
import { parseWorkbook } from "@/lib/import/parse";
import { validateImportRow } from "@/lib/import/validate";
import { requireRole } from "@/lib/auth/get-user";
import { getServerEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ batch: string }> },
) {
  const user = await requireRole(["admin", "owner"]);
  const { batch } = await context.params;
  const formData = await request.formData();
  const file = formData.get("file");
  const templateCode = String(formData.get("templateCode") ?? "LINES_GENERIC");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Choose an Excel or CSV file." }, { status: 400 });
  }
  const template = getImportTemplate(templateCode);
  if (!template) return NextResponse.json({ error: "Unknown import template." }, { status: 400 });
  if (!/\.(xls|xlsx|csv)$/i.test(file.name)) {
    return NextResponse.json({ error: "Only .xls, .xlsx and .csv files are allowed." }, { status: 400 });
  }
  if (getServerEnv().DEMO_MODE && !/^synthetic[-_]/i.test(file.name)) {
    return NextResponse.json({ error: "Real imports are disabled in the demo. Use a bundled synthetic fixture." }, { status: 403 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");
  const supabase = await createClient();
  const { error: batchError } = await supabase.from("import_batch").insert({
    id: batch,
    created_by: user.id,
    template_code: template.code,
    source_file_name: file.name,
    source_sha256: hash,
    source_size_bytes: bytes.byteLength,
    source_mime_type: file.type || "application/octet-stream",
    status: "pending",
  });
  if (batchError) return NextResponse.json({ error: batchError.message }, { status: 400 });

  try {
    const parsed = parseWorkbook(bytes, file.name);
    const rows = parsed.sheets;
    const firstSheetRows = rows.filter((row) => row.sheet === parsed.sheets[0]?.sheet);
    const header = detectHeaderRow(
      firstSheetRows.map((row) => Object.values(row.cells).map((cell) => cell.value)),
      { synonyms: template.synonyms },
    );
    if (!header) throw new Error("IMPORT_HEADER_NOT_FOUND: No matching header was found in the first 15 rows.");

    const { data: rawRows, error: rawError } = await supabase
      .schema("staging")
      .from("raw_row")
      .insert(rows.map((row) => ({
        import_batch_id: batch,
        source_workbook: row.workbook,
        source_sheet: row.sheet,
        source_row: row.rowNumber,
        context_fy: row.contextFy,
        cells: row.cells,
        is_section_row: row.isSectionRow,
        had_formula: row.hadFormula,
      })))
      .select("id, source_row, cells");
    if (rawError) throw new Error(rawError.message);

    const mappedRows = (rawRows ?? []).map((row) => {
      const values = Object.fromEntries(
        Object.entries((row.cells ?? {}) as Record<string, { value?: unknown }>).map(([key, cell]) => [key, cell.value]),
      );
      const errors = validateImportRow(row.source_row, values, { requiredFields: [] });
      return { raw_row_id: row.id, target_entity: template.targetEntity, payload: values, validation_status: errors.some((error) => error.severity === "blocking") ? "blocking" : errors.some((error) => error.severity === "warning") ? "warning" : "ok", errors };
    });
    const mappedPayload = mappedRows.map((row) => ({
      raw_row_id: row.raw_row_id,
      target_entity: row.target_entity,
      payload: row.payload,
      validation_status: row.validation_status,
    }));
    const { error: mappedError } = await supabase.schema("staging").from("mapped_row").insert(mappedPayload);
    if (mappedError) throw new Error(mappedError.message);
    const errors = mappedRows.flatMap((row) => row.errors.map((error) => ({ import_batch_id: batch, raw_row_id: row.raw_row_id, field: error.field ?? null, severity: error.severity, rule_code: error.ruleCode, message: error.message, raw_value: error.rawValue ?? null })));
    if (errors.length > 0) {
      const { error: errorInsert } = await supabase.from("import_error").insert(errors);
      if (errorInsert) throw new Error(errorInsert.message);
    }
    const blocking = errors.filter((error) => error.severity === "blocking").length;
    const warnings = errors.filter((error) => error.severity === "warning").length;
    const { error: updateError } = await supabase.from("import_batch").update({ status: blocking > 0 ? "staged" : "validated", row_count: rows.length, blocking_error_count: blocking, warning_count: warnings, is_validated: blocking === 0 }).eq("id", batch);
    if (updateError) throw new Error(updateError.message);
    return NextResponse.json({ batch, headerRow: header.rowNumber, rows: rows.length, blocking, warnings });
  } catch (error) {
    await supabase.from("import_batch").update({ status: "failed" }).eq("id", batch);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Import failed." }, { status: 422 });
  }
}
