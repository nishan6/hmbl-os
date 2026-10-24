/*
 * Pure rules for documents (docs/documents.md): which files are
 * refused, how names are cleaned, and which types may be previewed.
 */

export const DOCUMENT_CATEGORIES = {
  CONTRACT: "Contract",
  SIGNED_AGREEMENT: "Signed agreement",
  QUOTATION: "Quotation or proposal",
  CLIENT_PO: "Client purchase order",
  VENDOR_PO: "Vendor purchase order or quote",
  INVOICE: "Invoice",
  RECEIPT: "Receipt or proof of payment",
  EXPENSE_EVIDENCE: "Expense evidence",
  TECHNICAL: "Technical document",
  CALL_SHEET: "Call sheet or run of show",
  EQUIPMENT_CHECKLIST: "Equipment checklist",
  TRAVEL: "Travel document",
  DELIVERABLE: "Client deliverable",
  CLOSEOUT_REPORT: "Closeout report",
  COMPLIANCE: "Registration, insurance or compliance",
  IDENTITY: "Identity document",
  OTHER: "Other",
} as const;
export type DocumentCategory = keyof typeof DOCUMENT_CATEGORIES;

/**
 * Years a document is kept at least, by category (default, not yet confirmed:
 * docs/decisions.md "Document retention"). Books of account and their
 * vouchers are kept eight years (Companies Act 2013, s.128). Nothing is
 * deleted in Version 1; the date is shown so nobody archives too early.
 */
const RETENTION_YEARS: Partial<Record<DocumentCategory, number>> = {
  CONTRACT: 8,
  SIGNED_AGREEMENT: 8,
  CLIENT_PO: 8,
  VENDOR_PO: 8,
  INVOICE: 8,
  RECEIPT: 8,
  EXPENSE_EVIDENCE: 8,
};

/** The date a document must be kept until, or null when no period applies. */
export function retainUntil(category: DocumentCategory, uploadedAt: Date) {
  const years = RETENTION_YEARS[category];
  if (!years) return null;
  // To the end of the financial year (April to March), that many years on.
  const yearEnd = uploadedAt.getUTCFullYear() + (uploadedAt.getUTCMonth() >= 3 ? 1 : 0);
  return new Date(Date.UTC(yearEnd + years, 2, 31));
}

/** Identity documents are always restricted; the rest are standard unless chosen. */
export function forcedRestricted(category: DocumentCategory) {
  return category === "IDENTITY";
}

/** Programs and scripts: refused, because a download could run them. */
const BLOCKED = new Set([
  "app",
  "bat",
  "cmd",
  "com",
  "cpl",
  "dll",
  "exe",
  "hta",
  "jar",
  "js",
  "jse",
  "lnk",
  "mjs",
  "msi",
  "msp",
  "ps1",
  "psm1",
  "reg",
  "scr",
  "sh",
  "vb",
  "vbe",
  "vbs",
  "ws",
  "wsf",
]);

/** Shown in the browser; everything else is downloaded. */
const PREVIEW: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export function extensionOf(fileName: string) {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "";
}

/** The base name only, without control characters, at most 255 characters. */
export function cleanFileName(raw: string) {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f"]/g, "").trim();
  if (clean.length <= 255) return clean;
  const ext = extensionOf(clean);
  return ext ? `${clean.slice(0, 254 - ext.length)}.${ext}` : clean.slice(0, 255);
}

export function isBlocked(fileName: string) {
  return BLOCKED.has(extensionOf(fileName));
}

/** The type to store: known from the extension, else the browser's, else generic. */
export function contentTypeFor(fileName: string, claimed: string | null) {
  const known = PREVIEW[extensionOf(fileName)];
  if (known) return known;
  return claimed && /^[\w.+-]+\/[\w.+-]+$/.test(claimed) ? claimed : "application/octet-stream";
}

/** Whether a document can open in the browser rather than download. */
export function canPreview(fileName: string) {
  return extensionOf(fileName) in PREVIEW;
}
