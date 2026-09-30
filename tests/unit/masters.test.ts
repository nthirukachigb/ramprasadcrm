import { describe, expect, it } from "vitest";

import { certificateStatus } from "@/lib/masters/status";
import {
  commissionAgreementSchema,
  containsCredentialLikeText,
  customerSchema,
  normalizeName,
  portalReferenceSchema,
  productSchema,
} from "@/lib/schemas/masters";

describe("normalizeName", () => {
  it("lowercases, trims and collapses spaces", () => {
    expect(normalizeName("  Demo   Ordnance  ")).toBe("demo ordnance");
  });
});

describe("productSchema", () => {
  it("rejects a product without a unit of measure", () => {
    const result = productSchema.safeParse({
      internalPartNumber: "X-1",
      description: "Thing",
      uom: "",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid product", () => {
    const result = productSchema.safeParse({
      internalPartNumber: "X-1",
      description: "Thing",
      uom: "EA",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a non-numeric HSN code", () => {
    const result = productSchema.safeParse({
      internalPartNumber: "X-1",
      description: "Thing",
      uom: "EA",
      hsnCode: "ABC",
    });
    expect(result.success).toBe(false);
  });
});

describe("commissionAgreementSchema", () => {
  it("rejects a percentage above 100", () => {
    const result = commissionAgreementSchema.safeParse({
      partnerId: "11111111-1111-4111-8111-111111111111",
      commissionPercent: 120,
      effectiveFrom: "2026-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an end date before the start date", () => {
    const result = commissionAgreementSchema.safeParse({
      partnerId: "11111111-1111-4111-8111-111111111111",
      commissionPercent: 8,
      effectiveFrom: "2026-06-01",
      effectiveTo: "2026-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid agreement", () => {
    const result = commissionAgreementSchema.safeParse({
      partnerId: "11111111-1111-4111-8111-111111111111",
      commissionPercent: 8,
      effectiveFrom: "2026-01-01",
    });
    expect(result.success).toBe(true);
  });
});

describe("credential guard", () => {
  it("detects credential-like text", () => {
    expect(containsCredentialLikeText("password: hunter2")).toBe(true);
    expect(containsCredentialLikeText("api_key=abc")).toBe(true);
    expect(containsCredentialLikeText("GeM portal reference")).toBe(false);
  });

  it("rejects a portal reference containing a credential", () => {
    const result = portalReferenceSchema.safeParse({
      customerId: "11111111-1111-4111-8111-111111111111",
      portalName: "GeM",
      notes: "password: hunter2",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a plain portal reference", () => {
    const result = portalReferenceSchema.safeParse({
      customerId: "11111111-1111-4111-8111-111111111111",
      portalName: "GeM",
      portalUrl: "https://gem.gov.in",
    });
    expect(result.success).toBe(true);
  });
});

describe("customerSchema", () => {
  it("trims the name and requires at least two characters", () => {
    expect(customerSchema.safeParse({ name: "A" }).success).toBe(false);
    const parsed = customerSchema.safeParse({ name: "  Demo  " });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.name).toBe("Demo");
  });
});

describe("certificateStatus", () => {
  const now = new Date("2026-09-30T00:00:00Z");

  it("reports expired for a past date", () => {
    expect(certificateStatus("2024-01-01", now)).toBe("expired");
  });

  it("reports expiring within the window", () => {
    expect(certificateStatus("2026-10-15", now)).toBe("expiring");
  });

  it("reports valid for a far-future date", () => {
    expect(certificateStatus("2030-01-01", now)).toBe("valid");
  });

  it("treats a certificate with no expiry as valid", () => {
    expect(certificateStatus(null, now)).toBe("valid");
  });

  it("reports no evidence for an invalid date", () => {
    expect(certificateStatus("nonsense", now)).toBe("no_evidence");
  });
});
