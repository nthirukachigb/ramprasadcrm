import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { detectHeaderRow } from "../src/lib/import/header-detect";
import { parseWorkbook } from "../src/lib/import/parse";
import { validateImportRow } from "../src/lib/import/validate";

const fixture = join(process.cwd(), "tests", "fixtures", "workbooks", "synthetic-enquiry.xlsx");
if (!existsSync(fixture)) throw new Error("Run fixtures:make first.");
const parsed = parseWorkbook(readFileSync(fixture), "synthetic-enquiry.xlsx");
const rows = parsed.sheets.filter((row) => row.sheet === parsed.sheets[0]?.sheet);
const header = detectHeaderRow(rows.map((row) => Object.values(row.cells).map((cell) => cell.value)), { synonyms: { partNumber: ["part no"], description: ["description"], quantity: ["qty"], uom: ["uom"] } });
const checks = [
  ["workbook parsed", rows.length > 0],
  ["header detected", header?.rowNumber === 3],
  ["FY section recorded", rows.some((row) => row.isSectionRow && row.contextFy === "2026-27")],
  ["credential rule blocks", validateImportRow(1, { notes: "password=blocked" }).some((error) => error.ruleCode === "CREDENTIAL_DETECTED")],
] as const;
for (const [name, pass] of checks) console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
if (checks.some(([, pass]) => !pass)) process.exit(1);
