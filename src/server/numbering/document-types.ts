/**
 * Documents that get a human-readable number. Modules add their type here when
 * they start issuing numbers.
 */
export const DOCUMENT_TYPES = {
  quotation: { label: "Quotation", scope: "entity" },
  project: { label: "Project", scope: "entity" },
  sales_invoice: { label: "Sales invoice", scope: "entity" },
  credit_note: { label: "Credit note", scope: "entity" },
  receipt: { label: "Receipt", scope: "entity" },
  purchase_order: { label: "Purchase order", scope: "entity" },
  vendor_bill: { label: "Vendor bill", scope: "entity" },
  expense_claim: { label: "Expense claim", scope: "entity" },
  journal: { label: "Journal", scope: "entity" },
} as const satisfies Record<string, { label: string; scope: "entity" | "group" }>;

export type DocumentType = keyof typeof DOCUMENT_TYPES;

export function isDocumentType(value: string): value is DocumentType {
  return Object.hasOwn(DOCUMENT_TYPES, value);
}

/**
 * DEFAULT NUMBER FORMATS — labelled starting points, not approved policy
 * (docs/decisions.md, "Numbering schemes"). Indian GST invoice numbers must be
 * at most 16 characters of letters, digits, "-" and "/", unique within a
 * financial year; the finance-facing defaults below fit that, but the final
 * formats need sign-off from HMBL's finance team.
 */
export const DEFAULT_SCHEMES: Record<
  DocumentType,
  { pattern: string; resetPolicy: "NEVER" | "YEARLY" | "FISCAL_YEARLY" | "MONTHLY" }
> = {
  quotation: { pattern: "Q-{FYY}-{SEQ:4}", resetPolicy: "FISCAL_YEARLY" },
  project: { pattern: "P-{FYY}-{SEQ:4}", resetPolicy: "FISCAL_YEARLY" },
  sales_invoice: { pattern: "INV/{FYY}/{SEQ:5}", resetPolicy: "FISCAL_YEARLY" },
  credit_note: { pattern: "CN/{FYY}/{SEQ:5}", resetPolicy: "FISCAL_YEARLY" },
  receipt: { pattern: "RCT/{FYY}/{SEQ:5}", resetPolicy: "FISCAL_YEARLY" },
  purchase_order: { pattern: "PO/{FYY}/{SEQ:5}", resetPolicy: "FISCAL_YEARLY" },
  vendor_bill: { pattern: "VB/{FYY}/{SEQ:5}", resetPolicy: "FISCAL_YEARLY" },
  expense_claim: { pattern: "EXP/{FYY}/{SEQ:5}", resetPolicy: "FISCAL_YEARLY" },
  journal: { pattern: "JV/{FYY}/{SEQ:5}", resetPolicy: "FISCAL_YEARLY" },
};
