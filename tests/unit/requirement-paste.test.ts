import { describe, expect, it } from "vitest";

import { parsePastedLines } from "@/lib/requirements/paste";

describe("parsePastedLines", () => {
  it("parses TSV rows with an optional leading line number", () => {
    const { rows, errors } = parsePastedLines(
      "CUST-1\tOEM-1\tINT-1\tWidget\t100\tNO\t2026-04-01\tnote",
      1,
    );
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      line_no: 1,
      customer_part_no: "CUST-1",
      oem_part_no: "OEM-1",
      internal_part_no: "INT-1",
      description: "Widget",
      quantity_required: "100",
      uom: "NO",
      required_delivery_date: "2026-04-01",
      line_notes: "note",
    });
  });

  it("numbers rows from the supplied start and skips invalid rows", () => {
    const text = [
      "A\t\t\tBolt\t10\tNO",
      "B\t\t\t\t5\tNO", // missing description
      "C\t\t\tNut\t0\tNO", // zero quantity
      "D\t\t\tWasher\t4\t", // missing uom
      "E\t\t\tScrew\t2\tEA",
    ].join("\n");

    const { rows, errors } = parsePastedLines(text, 10);
    expect(rows.map((row) => row.line_no)).toEqual([10, 11]);
    expect(rows[1]?.description).toBe("Screw");
    expect(errors).toHaveLength(3);
  });

  it("returns nothing for empty input", () => {
    const { rows, errors } = parsePastedLines("   \n  ", 1);
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});
