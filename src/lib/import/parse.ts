import * as XLSX from "xlsx";

import {
  fiscalYearFromRow,
  isFiscalYearSectionRow,
} from "@/lib/import/header-detect";

export interface ParsedCell {
  value: unknown;
  type: string;
  formatted: string;
  formula?: string;
}

export interface ParsedRow {
  workbook: string;
  sheet: string;
  rowNumber: number;
  cells: Record<string, ParsedCell>;
  contextFy: string | null;
  isSectionRow: boolean;
  hadFormula: boolean;
}

export interface ParsedWorkbook {
  fileName: string;
  workbookDateSystem: 1900 | 1904;
  sheets: ParsedRow[];
  merges: Record<string, string[]>;
  hiddenSheets: string[];
}

export function parseWorkbook(input: ArrayBuffer | Uint8Array, fileName: string): ParsedWorkbook {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength === 0) throw new Error("IMPORT_EMPTY_FILE: The workbook is empty.");
  if (/\.(xlsm|xltm|docm)$/i.test(fileName)) {
    throw new Error("IMPORT_MACRO_FILE: Macro-enabled files are not allowed.");
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(bytes, {
      type: "array",
      raw: true,
      cellDates: false,
      cellNF: true,
      cellFormula: true,
      sheetStubs: true,
    });
  } catch {
    throw new Error("IMPORT_CORRUPT_FILE: The workbook cannot be read. Password-protected files are not supported.");
  }

  const dateSystem = workbook.Workbook?.WBProps?.date1904 ? 1904 : 1900;
  const rows: ParsedRow[] = [];
  const merges: Record<string, string[]> = {};

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    merges[sheetName] = (sheet["!merges"] ?? []).map((merge) => XLSX.utils.encode_range(merge));
    const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
    let contextFy: string | null = null;
    for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
      const row: unknown[] = [];
      const cells: Record<string, ParsedCell> = {};
      let hadFormula = false;
      for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex += 1) {
        const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
        const cell = sheet[address] as XLSX.CellObject | undefined;
        row.push(cell?.v ?? "");
        if (cell) {
          const formula = typeof cell.f === "string" ? cell.f : undefined;
          hadFormula ||= Boolean(formula);
          cells[address] = {
            value: cell.v,
            type: cell.t ?? "z",
            formatted: cell.w ?? String(cell.v ?? ""),
            ...(formula ? { formula } : {}),
          };
        }
      }
      const isSectionRow = isFiscalYearSectionRow(row);
      if (isSectionRow) contextFy = fiscalYearFromRow(row);
      rows.push({
        workbook: fileName,
        sheet: sheetName,
        rowNumber: rowIndex + 1,
        cells,
        contextFy,
        isSectionRow,
        hadFormula,
      });
    }
  }

  return {
    fileName,
    workbookDateSystem: dateSystem,
    sheets: rows,
    merges,
    hiddenSheets: workbook.Workbook?.Sheets?.flatMap((sheet, index) =>
      sheet.Hidden ? [workbook.SheetNames[index] ?? ""] : [],
    ) ?? [],
  };
}
