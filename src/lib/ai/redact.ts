const EMAIL_RE = /[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?\d[\d\s().\-]{7,}\d)/g;
const GSTIN_RE = /\b[A-Z0-9]{15}\b/g;
const PAN_RE = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g;
const LONG_DIGIT_RE = /\b\d{8,}\b/g;

export function redactSensitiveText(value: string): string {
  let redacted = value ?? "";
  redacted = redacted.replace(EMAIL_RE, "[REDACTED_EMAIL]");
  redacted = redacted.replace(PHONE_RE, "[REDACTED_PHONE]");
  redacted = redacted.replace(GSTIN_RE, "[REDACTED_GSTIN]");
  redacted = redacted.replace(PAN_RE, "[REDACTED_PAN]");
  redacted = redacted.replace(LONG_DIGIT_RE, "[REDACTED_NUMERIC]");
  return redacted;
}
