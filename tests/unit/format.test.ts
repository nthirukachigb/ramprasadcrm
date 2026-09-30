import { describe, expect, it } from "vitest";

import { formatDate, formatINR, formatQty } from "@/lib/format";

describe("formatINR", () => {
  it("uses Indian digit grouping with two decimals", () => {
    expect(formatINR(1234567.5)).toBe("₹12,34,567.50");
  });

  it("formats zero and small values", () => {
    expect(formatINR(0)).toBe("₹0.00");
    expect(formatINR(100)).toBe("₹100.00");
  });

  it("accepts numeric strings", () => {
    expect(formatINR("98765.4")).toBe("₹98,765.40");
  });

  it("returns a placeholder for invalid input", () => {
    expect(formatINR("not-a-number")).toBe("—");
    expect(formatINR(Number.NaN)).toBe("—");
  });
});

describe("formatQty", () => {
  it("groups thousands and keeps up to three decimals", () => {
    expect(formatQty(1234.5)).toBe("1,234.5");
    expect(formatQty("1000.25")).toBe("1,000.25");
    expect(formatQty(2)).toBe("2");
  });

  it("returns a placeholder for invalid input", () => {
    expect(formatQty("abc")).toBe("—");
  });
});

describe("formatDate", () => {
  it("renders dd-MMM-yyyy in Asia/Kolkata", () => {
    expect(formatDate("2026-09-30T12:00:00Z")).toBe("30-Sep-2026");
    expect(formatDate("2026-01-05T12:00:00Z")).toBe("05-Jan-2026");
  });

  it("accepts Date objects", () => {
    expect(formatDate(new Date("2026-12-25T12:00:00Z"))).toBe("25-Dec-2026");
  });

  it("returns a placeholder for invalid input", () => {
    expect(formatDate("nonsense")).toBe("—");
  });
});
