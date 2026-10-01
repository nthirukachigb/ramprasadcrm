import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import { detectHeaderRow, isFiscalYearSectionRow } from "@/lib/import/header-detect";
import { parseWorkbook } from "@/lib/import/parse";
import { parseImportDate, normalisePartNumber, validateImportRow } from "@/lib/import/validate";

const lineSynonyms = {
  partNumber: ["part no", "part number"],
  description: ["description", "item"],
  quantity: ["qty", "quantity"],
  uom: ["uom", "unit"],
};

describe("Phase 14 import parser", () => {
  it("finds a header in the first 15 rows and preserves section context", () => {
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Synthetic workbook"],
      ["FY 2026-27"],
      ["Part No", "Description", "Qty", "UoM"],
      ["0004711", "Relay", 3, "Nos"],
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "MASTER");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const parsed = parseWorkbook(bytes, "synthetic-lines.xlsx");
    const rows = parsed.sheets.filter((row) => row.sheet === "MASTER");
    const header = detectHeaderRow(rows.map((row) => Object.values(row.cells).map((cell) => cell.value)), { synonyms: lineSynonyms });
    expect(header?.rowNumber).toBe(3);
    expect(rows.find((row) => row.isSectionRow)?.contextFy).toBe("2026-27");
    expect(rows[3]?.cells.A4.value).toBe("0004711");
  });

  it("recognises fiscal year rows and refuses macro extensions", () => {
    expect(isFiscalYearSectionRow(["MASTER ORDER BOOKING LIST - 24-25"])).toBe(true);
    expect(() => parseWorkbook(new Uint8Array([1]), "unsafe.xlsm")).toThrow("IMPORT_MACRO_FILE");
  });
});

describe("Phase 14 validation", () => {
  it("converts serial dates and reports unparsed text dates", () => {
    expect(parseImportDate(46000).value).toBe("2025-12-09");
    expect(parseImportDate("IMM").error?.ruleCode).toBe("DATE_TEXT_UNPARSED");
  });

  it("preserves part number matching and blocks credentials", () => {
    expect(normalisePartNumber("4711 002-300/01")).toBe("471100230001");
    const errors = validateImportRow(8, { partNumber: "0004711", quantity: "0", password: "password=secret" }, { requiredFields: ["uom"] });
    expect(errors.map((error) => error.ruleCode)).toEqual(expect.arrayContaining(["NUMBER_INVALID", "REQUIRED_MISSING", "CREDENTIAL_DETECTED"]));
  });
});
