export type ImportSeverity = "blocking" | "warning" | "info";

export interface ImportError {
  rowNumber: number;
  field?: string;
  severity: ImportSeverity;
  ruleCode: string;
  message: string;
  rawValue?: string;
}

export interface ValidationContext {
  dateSystem?: 1900 | 1904;
  requiredFields?: string[];
  knownUoms?: string[];
  scaleFactor?: number;
}

const credentialPattern = /(?:password|passwd|pwd|login\s*[:=]|user\s*name\s*[:=])/i;
const explicitDatePattern = /^(?:\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2})$/;

export function excelSerialToDate(value: number, dateSystem: 1900 | 1904 = 1900): Date | null {
  if (!Number.isFinite(value) || value < 1) return null;
  const epoch = dateSystem === 1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const date = new Date(epoch + value * 86_400_000);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseImportDate(
  value: unknown,
  dateSystem: 1900 | 1904 = 1900,
): { value: string | null; error?: ImportError } {
  if (value === null || value === undefined || String(value).trim() === "") {
    return { value: null };
  }
  if (typeof value === "number") {
    const date = excelSerialToDate(value, dateSystem);
    if (!date || date.getUTCFullYear() < 2015 || date.getUTCFullYear() > 2035) {
      return {
        value: null,
        error: { rowNumber: 0, severity: "blocking", ruleCode: "DATE_OUT_OF_RANGE", message: "Excel date is outside the accepted 2015–2035 range.", rawValue: String(value) },
      };
    }
    return { value: date.toISOString().slice(0, 10) };
  }
  const text = String(value).trim();
  if (!explicitDatePattern.test(text)) {
    return {
      value: null,
      error: { rowNumber: 0, severity: "warning", ruleCode: "DATE_TEXT_UNPARSED", message: "Text date was not recognised; it was not guessed.", rawValue: text },
    };
  }
  const parts = text.split(/[-/.]/).map(Number);
  const [a, b, c] = parts;
  const year = c < 100 ? 2000 + c : c;
  const date = text.startsWith(String(year)) ? new Date(Date.UTC(a, b - 1, c)) : new Date(Date.UTC(year, b - 1, a));
  if (Number.isNaN(date.getTime())) {
    return { value: null, error: { rowNumber: 0, severity: "blocking", ruleCode: "DATE_INVALID", message: "Date is invalid.", rawValue: text } };
  }
  return { value: date.toISOString().slice(0, 10) };
}

export function validateImportRow(
  rowNumber: number,
  values: Record<string, unknown>,
  context: ValidationContext = {},
): ImportError[] {
  const errors: ImportError[] = [];
  for (const [field, value] of Object.entries(values)) {
    const text = String(value ?? "").trim();
    if (credentialPattern.test(text)) {
      errors.push({ rowNumber, field, severity: "blocking", ruleCode: "CREDENTIAL_DETECTED", message: "Credential-like content is not allowed in imports.", rawValue: text });
    }
  }
  for (const field of context.requiredFields ?? []) {
    if (String(values[field] ?? "").trim() === "") {
      errors.push({ rowNumber, field, severity: "blocking", ruleCode: "REQUIRED_MISSING", message: `${field} is required.` });
    }
  }
  if (values.quantity !== undefined && values.quantity !== "") {
    const quantity = Number(String(values.quantity).replace(/,/g, ""));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      errors.push({ rowNumber, field: "quantity", severity: "blocking", ruleCode: "NUMBER_INVALID", message: "Quantity must be a positive number.", rawValue: String(values.quantity) });
    }
  }
  if (values.uom !== undefined && context.knownUoms && !context.knownUoms.includes(String(values.uom).toLowerCase())) {
    errors.push({ rowNumber, field: "uom", severity: "blocking", ruleCode: "UOM_UNKNOWN", message: "UoM is not in the configured reference list.", rawValue: String(values.uom) });
  }
  const partNumber = String(values.partNumber ?? "");
  if (/\d{16,}|\d+e\+\d+/i.test(partNumber)) {
    errors.push({ rowNumber, field: "partNumber", severity: "warning", ruleCode: "PARTNO_NUMERIC_PRECISION", message: "Part number may have been coerced to numeric form; verify leading zeros and precision.", rawValue: partNumber });
  }
  return errors;
}

export function normalisePartNumber(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/[\s\-./\\]+/g, "");
}

export function parseScaledNumber(value: unknown, scaleFactor = 1): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const numeric = Number(String(value).replace(/,/g, "").trim());
  return Number.isFinite(numeric) ? numeric * scaleFactor : null;
}
