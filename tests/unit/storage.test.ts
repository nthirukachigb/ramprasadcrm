import { describe, expect, it } from "vitest";

import {
  checkUpload,
  extensionOf,
  MAX_UPLOAD_BYTES,
} from "@/lib/platform/storage";

describe("extensionOf", () => {
  it("returns the lowercase extension", () => {
    expect(extensionOf("Tender.PDF")).toBe("pdf");
    expect(extensionOf("no-extension")).toBe("");
  });
});

describe("checkUpload", () => {
  it("accepts an allowed PDF", () => {
    const result = checkUpload("tender.pdf", "application/pdf", 1024);
    expect(result.ok).toBe(true);
    expect(result.extension).toBe("pdf");
  });

  it("rejects macro-enabled and executable files", () => {
    expect(checkUpload("sheet.xlsm", "application/vnd.ms-excel", 100).ok).toBe(false);
    expect(checkUpload("virus.exe", "application/octet-stream", 100).ok).toBe(false);
  });

  it("rejects an unknown extension", () => {
    const result = checkUpload("notes.txt", "text/plain", 100);
    expect(result.ok).toBe(false);
    expect(result.error).toContain(".txt");
  });

  it("rejects a MIME that does not match the extension", () => {
    const result = checkUpload("photo.png", "application/pdf", 100);
    expect(result.ok).toBe(false);
  });

  it("rejects empty and oversize files", () => {
    expect(checkUpload("a.pdf", "application/pdf", 0).ok).toBe(false);
    expect(
      checkUpload("a.pdf", "application/pdf", MAX_UPLOAD_BYTES + 1).ok,
    ).toBe(false);
  });
});
