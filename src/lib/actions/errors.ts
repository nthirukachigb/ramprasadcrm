/** Maps a database or RPC error message to a plain-language user message. */
export function friendlyError(message: string, code?: string): string {
  if (code === "23505" || /duplicate key/i.test(message)) {
    return "A record with this reference already exists.";
  }
  if (message.includes("FR-RFI-02")) {
    return "This requirement already holds the maximum number of lines (500).";
  }
  if (message.includes("BR-30")) {
    return "That status change is not allowed from the current status.";
  }
  if (message.includes("BR-14")) {
    return "Owner approval is required before this decision.";
  }
  if (message.includes("BR-17")) {
    return "This approval has already been decided and cannot be changed.";
  }
  if (message.includes("QUOTE_GATE")) {
    return message.replace(/^.*QUOTE_GATE:\s*/, "");
  }
  if (message.includes("BR-19")) {
    return "This quotation version is locked once approved; create a revision instead.";
  }
  if (message.includes("BR-01")) {
    return "The quotation line must belong to the requirement's own lines.";
  }
  if (message.includes("FR-QUOTE-07")) {
    return "A late submission needs a reason.";
  }
  if (message.includes("COMMITMENT_VERSION_REQUIRED")) {
    return "Change the commitment through Change, which creates a new version.";
  }
  if (message.includes("DOCUMENT_LINK_TARGET_MISSING")) {
    return "The document cannot be linked to that record.";
  }
  if (message.includes("FORBIDDEN")) {
    return "You do not have permission to do that.";
  }
  if (/row-level security|permission denied/i.test(message)) {
    return "You do not have permission to change this record.";
  }
  return "Could not save. Please check the values and try again.";
}
