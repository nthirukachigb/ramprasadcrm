import { describe, expect, it } from "vitest";

import {
  landedUnitCost,
  linePricing,
  marginPct,
  quotationTotals,
  suggestPrice,
} from "@/lib/calc/pricing";

describe("landedUnitCost", () => {
  it("adds cost, freight and other, treating null as zero", () => {
    expect(landedUnitCost(60, 5, 2)).toBe(67);
    expect(landedUnitCost(60, null, undefined)).toBe(60);
    expect(landedUnitCost(null, null, null)).toBe(0);
  });
});

describe("marginPct", () => {
  it("matches the SQL totals scenario (price 100, landed 67 → 33%)", () => {
    expect(marginPct(100, 67)).toBeCloseTo(33, 6);
  });

  it("returns null without a price", () => {
    expect(marginPct(null, 67)).toBeNull();
    expect(marginPct(0, 67)).toBeNull();
  });
});

describe("suggestPrice", () => {
  it("computes the price for a target margin", () => {
    expect(suggestPrice(67, 20)).toBe(83.75);
    expect(suggestPrice(67, 0)).toBe(67);
  });

  it("returns null for an impossible margin", () => {
    expect(suggestPrice(67, 100)).toBeNull();
    expect(suggestPrice(67, 120)).toBeNull();
    expect(suggestPrice(0, 20)).toBeNull();
  });
});

describe("linePricing", () => {
  it("matches the C-01 preview scenario", () => {
    const priced = linePricing({
      qtyQuoted: 800,
      unitCost: 60,
      freightUnit: 5,
      otherCostUnit: 2,
      proposedUnitPrice: 100,
    });
    expect(priced.landedUnitCost).toBe(67);
    expect(priced.netAmount).toBe(80000);
    expect(priced.costAmount).toBe(53600);
    expect(priced.marginAmount).toBe(26400);
    expect(priced.marginPct).toBeCloseTo(33, 6);
  });
});

describe("quotationTotals", () => {
  it("sums lines and includes tax in the gross", () => {
    const totals = quotationTotals(
      [
        { qtyQuoted: 800, unitCost: 60, freightUnit: 5, otherCostUnit: 2, proposedUnitPrice: 100 },
        { qtyQuoted: 100, unitCost: 10, freightUnit: 0, otherCostUnit: 0, proposedUnitPrice: 20 },
      ],
      18000,
    );
    expect(totals.netAmount).toBe(82000);
    expect(totals.costAmount).toBe(54600);
    expect(totals.taxAmount).toBe(18000);
    expect(totals.grossAmount).toBe(100000);
  });
});
