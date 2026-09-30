const EMPTY = "—";

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const qtyFormatter = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
});

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function toNumber(value: number | string): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Indian number grouping with two decimals, prefixed with the rupee sign. */
export function formatINR(value: number | string): string {
  const num = toNumber(value);
  if (num === null) return EMPTY;
  return inrFormatter.format(num);
}

/** Quantity with Indian grouping and up to three decimals. */
export function formatQty(value: number | string): string {
  const num = toNumber(value);
  if (num === null) return EMPTY;
  return qtyFormatter.format(num);
}

/** Date as dd-MMM-yyyy, rendered in India Standard Time. */
export function formatDate(value: Date | string | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);

  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const month = parts.find((p) => p.type === "month")?.value ?? "";
  const year = parts.find((p) => p.type === "year")?.value ?? "";
  const monthIndex = Number(month) - 1;
  const monthName = MONTHS[monthIndex] ?? month;

  if (!day || !year) return EMPTY;
  return `${day}-${monthName}-${year}`;
}
