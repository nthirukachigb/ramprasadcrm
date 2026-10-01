import { describe, expect, it } from "vitest";

import { AI_TOOL_DEFINITIONS, isAiEnabled, sanitizeToolCall } from "@/lib/ai/tools";
import { redactSensitiveText } from "@/lib/ai/redact";

describe("AI tool catalogue", () => {
  it("includes the read-only catalogued tools", () => {
    const names = AI_TOOL_DEFINITIONS.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "count_open_orders",
        "list_wins",
        "list_losses",
        "loss_reasons_breakdown",
      ]),
    );
  });

  it("only accepts valid tool parameters", () => {
    const result = sanitizeToolCall("count_open_orders", { status: ["open"], customer_id: "abc" });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/customer_id/i);
  });
});

describe("AI safety controls", () => {
  it("redacts emails, phone numbers and GSTIN-like values", () => {
    const question = "Contact owner@example.com or +91 90000 00000; GSTIN 27ABCDE1234F1Z5";
    expect(redactSensitiveText(question)).not.toContain("owner@example.com");
    expect(redactSensitiveText(question)).not.toContain("90000");
    expect(redactSensitiveText(question)).not.toContain("27ABCDE1234F1Z5");
  });

  it("defaults the feature flag to off", () => {
    expect(isAiEnabled()).toBe(false);
  });
});
