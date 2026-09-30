export interface ParsedLine {
  line_no: number;
  customer_part_no: string;
  oem_part_no: string;
  internal_part_no: string;
  description: string;
  quantity_required: string;
  uom: string;
  required_delivery_date: string;
  line_notes: string;
}

export interface ParseResult {
  rows: ParsedLine[];
  errors: string[];
}

/**
 * Parse spreadsheet-like TSV: optional leading line number, then
 * customer P/N, OEM P/N, internal P/N, description, quantity, UoM,
 * delivery date, notes. Invalid rows are skipped and reported by number.
 */
export function parsePastedLines(
  text: string,
  startLineNo: number,
): ParseResult {
  const rows: ParsedLine[] = [];
  const errors: string[] = [];

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  lines.forEach((line, index) => {
    const cells = line.split("\t").map((cell) => cell.trim());
    const offset = /^\d+$/.test(cells[0] ?? "") ? 1 : 0;
    const [customer, oem, internal, description, qty, uom, date, notes] =
      cells.slice(offset);

    if (!description) {
      errors.push(`Row ${index + 1}: description is missing.`);
      return;
    }
    const qtyNumber = Number(qty);
    if (!Number.isFinite(qtyNumber) || qtyNumber <= 0) {
      errors.push(`Row ${index + 1}: quantity must be greater than zero.`);
      return;
    }
    if (!uom) {
      errors.push(`Row ${index + 1}: UoM is missing.`);
      return;
    }

    rows.push({
      line_no: startLineNo + rows.length,
      customer_part_no: customer ?? "",
      oem_part_no: oem ?? "",
      internal_part_no: internal ?? "",
      description,
      quantity_required: String(qtyNumber),
      uom,
      required_delivery_date:
        date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "",
      line_notes: notes ?? "",
    });
  });

  return { rows, errors };
}
