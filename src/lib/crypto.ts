import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Field-level encryption for sensitive master data (tax registrations, bank
 * account details). AES-256-GCM with a random 12-byte IV per value and an
 * authentication tag. The key comes from FIELD_ENCRYPTION_KEY (base64, 32
 * bytes) and never leaves the server.
 *
 * Payload format: v1:<iv-b64>:<tag-b64>:<ciphertext-b64>
 *
 * This module has no Next.js imports so it can be unit tested; it must only be
 * imported from server-only code (Server Actions, Route Handlers, scripts).
 */

const VERSION = "v1";

function getKey(): Buffer {
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "FIELD_ENCRYPTION_KEY is required to encrypt or decrypt field data. Add it to .env.local (base64-encoded 32 bytes).",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      "FIELD_ENCRYPTION_KEY must decode to exactly 32 bytes (base64-encoded).",
    );
  }
  return key;
}

export function encryptField(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

export function decryptField(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Unrecognised encrypted field payload.");
  }
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/** Last four characters of a sensitive value, safe to display. */
export function last4(value: string): string {
  const trimmed = value.replace(/\s+/g, "");
  return trimmed.slice(-4);
}

/** Constant-time comparison, useful for guard checks. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
