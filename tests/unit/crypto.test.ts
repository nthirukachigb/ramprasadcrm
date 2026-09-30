import { beforeAll, describe, expect, it } from "vitest";

import { decryptField, encryptField, last4 } from "@/lib/crypto";

beforeAll(() => {
  process.env.FIELD_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

describe("field encryption", () => {
  it("round-trips a value", () => {
    const payload = encryptField("27AAAAA0000A1Z5");
    expect(payload.startsWith("v1:")).toBe(true);
    expect(payload).not.toContain("27AAAAA0000A1Z5");
    expect(decryptField(payload)).toBe("27AAAAA0000A1Z5");
  });

  it("produces a different payload each time (random IV)", () => {
    expect(encryptField("same")).not.toBe(encryptField("same"));
  });

  it("rejects a tampered payload", () => {
    const payload = encryptField("secret-value");
    const tampered = payload.slice(0, -2) + "AA";
    expect(() => decryptField(tampered)).toThrow();
  });

  it("returns the last four characters", () => {
    expect(last4("000123456789")).toBe("6789");
    expect(last4("DEMO 000 1234")).toBe("1234");
  });
});
