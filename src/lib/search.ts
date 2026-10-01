export function normalizeSearchQuery(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
