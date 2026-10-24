/**
 * HMBL bills in up to three steps from one number series: a proforma invoice,
 * a commercial invoice the client pays against (GST included), then the tax
 * invoice. Only the tax invoice is a GST invoice and posts to the ledger.
 */
export const INVOICE_KINDS = {
  PROFORMA: { label: "Proforma invoice", short: "Proforma" },
  COMMERCIAL: { label: "Commercial invoice", short: "Commercial" },
  TAX: { label: "Tax invoice", short: "Tax" },
} as const;

export type InvoiceKind = keyof typeof INVOICE_KINDS;

const ORDER: InvoiceKind[] = ["PROFORMA", "COMMERCIAL", "TAX"];

/** The kinds an issued invoice of `kind` can be turned into. */
export function laterKinds(kind: InvoiceKind): InvoiceKind[] {
  return ORDER.slice(ORDER.indexOf(kind) + 1);
}

/** The {CLIENT} code of clients without one of their own: one-off clients share it. */
export const ONE_OFF_CLIENT_CODE = "INT";
