/*
 * Pure rules for project documents (docs/documents.md): which files are
 * refused, how names are cleaned, and which types may be previewed.
 */

export const DOCUMENT_CATEGORIES = {
  CONTRACT: "Contract or signed agreement",
  CLIENT_PO: "Client purchase order",
  TECHNICAL: "Technical document",
  CALL_SHEET: "Call sheet or run of show",
  TRAVEL: "Travel document",
  DELIVERABLE: "Client deliverable",
  CLOSEOUT_REPORT: "Closeout report",
  OTHER: "Other",
} as const;
export type DocumentCategory = keyof typeof DOCUMENT_CATEGORIES;

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
