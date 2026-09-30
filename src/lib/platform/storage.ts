/**
 * Upload allow-list and MIME sniffing for the document vault (TECH-STACK §11.4).
 * The free hosted stack has no malware scanner, so files are stored as
 * "unscanned" and shown with a visible warning until a scanner is added.
 */

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB [Assumption]

/** Extension -> accepted MIME types. Macro-enabled formats are rejected. */
export const ALLOWED_TYPES: Record<string, string[]> = {
  pdf: ["application/pdf"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  xlsx: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/zip",
  ],
  xls: ["application/vnd.ms-excel", "application/octet-stream"],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/zip",
  ],
  csv: ["text/csv", "text/plain", "application/vnd.ms-excel"],
};

export const REJECTED_TYPES = ["xlsm", "docm", "xlsb", "exe", "bat", "cmd", "js", "dll"];

export function extensionOf(fileName: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match?.[1]?.toLowerCase() ?? "";
}

export interface UploadCheck {
  ok: boolean;
  error?: string;
  extension: string;
}

export function checkUpload(
  fileName: string,
  mimeType: string,
  sizeBytes: number,
): UploadCheck {
  const extension = extensionOf(fileName);

  if (!extension) {
    return { ok: false, error: "The file must have a recognised extension.", extension };
  }
  if (REJECTED_TYPES.includes(extension)) {
    return {
      ok: false,
      error: `File type .${extension} is not allowed.`,
      extension,
    };
  }
  const allowedMimes = ALLOWED_TYPES[extension];
  if (!allowedMimes) {
    return { ok: false, error: `File type .${extension} is not allowed.`, extension };
  }
  // Browsers sometimes report an empty or generic MIME type; when a specific
  // MIME is supplied it must be in the allow-list for the extension.
  if (
    mimeType &&
    mimeType !== "application/octet-stream" &&
    !allowedMimes.includes(mimeType)
  ) {
    return {
      ok: false,
      error: `The file content (${mimeType}) does not match its extension.`,
      extension,
    };
  }
  if (sizeBytes <= 0) {
    return { ok: false, error: "The file is empty.", extension };
  }
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: "The file is larger than the 25 MB limit.",
      extension,
    };
  }
  return { ok: true, extension };
}

export function signedUrlTtlSeconds(): number {
  const raw = process.env.SIGNED_URL_TTL_SECONDS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
}
