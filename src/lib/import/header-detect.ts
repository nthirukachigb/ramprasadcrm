export interface HeaderCandidate {
  rowNumber: number;
  score: number;
  mappings: Record<number, string>;
  values: string[];
}

export interface HeaderDetectionOptions {
  synonyms: Record<string, string[]>;
  maxRows?: number;
}

function normalise(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\r\n]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectHeaderRow(
  rows: unknown[][],
  options: HeaderDetectionOptions,
): HeaderCandidate | null {
  const synonymEntries = Object.entries(options.synonyms).flatMap(
    ([field, values]) => values.map((value) => [field, normalise(value)] as const),
  );
  let best: HeaderCandidate | null = null;

  rows.slice(0, options.maxRows ?? 15).forEach((row, index) => {
    const mappings: Record<number, string> = {};
    let score = 0;
    row.forEach((cell, column) => {
      const value = normalise(cell);
      if (!value) return;
      const match = synonymEntries.find(([, synonym]) => synonym === value);
      if (match && !Object.values(mappings).includes(match[0])) {
        mappings[column] = match[0];
        score += 1;
      }
    });
    if (score > 0 && (!best || score > best.score)) {
      best = {
        rowNumber: index + 1,
        score,
        mappings,
        values: row.map((cell) => String(cell ?? "")),
      };
    }
  });

  return best;
}

export function isFiscalYearSectionRow(row: unknown[]): boolean {
  const text = row
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return /(?:^|\s)(?:(?:19|20)\d{2}|\d{2})\s*[-/]\s*\d{2,4}(?:\s|$)/i.test(text)
    || /\b(?:fy\s*)?(?:(?:19|20)\d{2}|\d{2})\s*[-/]\s*\d{2,4}\b/i.test(text);
}

export function fiscalYearFromRow(row: unknown[]): string | null {
  const text = row.map((value) => String(value ?? "")).join(" ");
  const match = text.match(/\b((?:(?:19|20)\d{2}|\d{2})\s*[-/]\s*\d{2,4})\b/i);
  return match?.[1]?.replace(/\s+/g, "") ?? null;
}

export function isLikelyContinuationRow(row: unknown[]): boolean {
  return row.length > 0 && row.every((cell) => String(cell ?? "").trim() === "");
}
