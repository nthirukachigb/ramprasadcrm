import { describe, expect, it } from "vitest";

import { normalizeSearchQuery } from "@/lib/search";

describe("normalizeSearchQuery", () => {
  it("strips punctuation while preserving search keywords and part numbers", () => {
    expect(normalizeSearchQuery("PO/26-27/0013")).toBe("PO 26 27 0013");
    expect(normalizeSearchQuery("DX-1001")).toBe("DX 1001");
    expect(normalizeSearchQuery("  ACME  &  Co  ")).toBe("ACME Co");
  });

  it("returns an empty string for blank input", () => {
    expect(normalizeSearchQuery("   ")).toBe("");
    expect(normalizeSearchQuery("")).toBe("");
  });
});
