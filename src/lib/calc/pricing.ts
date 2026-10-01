/**
 * Quotation pricing previews (C-01…C-04). These mirror the SQL calculations in
 * `v_quotation_totals`; the database remains the authoritative source, these
 * functions only drive the live preview in the builder.
 */

export function round4(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function landedUnitCost(
  unitCost: number | null | undefined,
  freightUnit: number | null | undefined,
  otherCostUnit: number | null | undefined,
): number {
  return (unitCost ?? 0) + (freightUnit ?? 0) + (otherCostUnit ?? 0);
}

export function marginPct(
  proposedUnitPrice: number | null | undefined,
  landed: number,
): number | null {
  if (!proposedUnitPrice || proposedUnitPrice <= 0) return null;
  return ((proposedUnitPrice - landed) / proposedUnitPrice) * 100;
}

/** Suggested price for a target margin. Never 100% or more. */
export function suggestPrice(
  landed: number,
  targetMarginPct: number | null | undefined,
): number | null {
  if (targetMarginPct == null || targetMarginPct >= 100) return null;
  if (landed <= 0) return null;
  return round4(landed / (1 - targetMarginPct / 100));
}

export interface LinePricingInput {
  qtyQuoted: number;
  unitCost: number | null | undefined;
  freightUnit: number | null | undefined;
  otherCostUnit: number | null | undefined;
  proposedUnitPrice: number | null | undefined;
}

export interface LinePricing {
  landedUnitCost: number;
  netAmount: number;
  costAmount: number;
  marginAmount: number;
  marginPct: number | null;
}

export function linePricing(input: LinePricingInput): LinePricing {
  const landed = landedUnitCost(input.unitCost, input.freightUnit, input.otherCostUnit);
  const price = input.proposedUnitPrice ?? 0;
  const netAmount = round2(input.qtyQuoted * price);
  const costAmount = round2(input.qtyQuoted * landed);
  return {
    landedUnitCost: round4(landed),
    netAmount,
    costAmount,
    marginAmount: round2(netAmount - costAmount),
    marginPct: marginPct(price, landed),
  };
}

export interface QuotationTotals {
  netAmount: number;
  costAmount: number;
  taxAmount: number;
  grossAmount: number;
  marginPct: number | null;
}

export function quotationTotals(
  lines: LinePricingInput[],
  taxAmount = 0,
): QuotationTotals {
  let netAmount = 0;
  let costAmount = 0;
  for (const line of lines) {
    const priced = linePricing(line);
    netAmount += priced.netAmount;
    costAmount += priced.costAmount;
  }
  netAmount = round2(netAmount);
  costAmount = round2(costAmount);
  return {
    netAmount,
    costAmount,
    taxAmount: round2(taxAmount),
    grossAmount: round2(netAmount + taxAmount),
    marginPct: netAmount > 0 ? ((netAmount - costAmount) / netAmount) * 100 : null,
  };
}
