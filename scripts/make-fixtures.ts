import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";

const output = join(process.cwd(), "tests", "fixtures", "workbooks");
mkdirSync(output, { recursive: true });

function writeWorkbook(fileName: string, rows: unknown[][]) {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "SYNTHETIC");
  writeFileSync(join(output, fileName), XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

writeWorkbook("synthetic-enquiry.xlsx", [
  ["Synthetic Enquiry Workbook"],
  ["FY 2026-27"],
  ["Part No", "Description", "Qty", "UoM", "Required Delivery Date"],
  ["DX-1001", "Power Distribution Unit", 10, "Nos", 46000],
  ["DX-1002", "Harness Assembly", 25, "m", "IMM"],
]);

writeWorkbook("synthetic-lines-bad.xlsx", [
  ["Part Number", "Description", "Quantity", "UoM"],
  ["0004711", "Relay Module", 0, "Nos"],
  ["DX-1002", "Harness Assembly", 4, ""],
  ["DX-1003", "Credential-like row", 2, "password=not-a-secret"],
]);

console.log(`Created synthetic import fixtures in ${output}`);
