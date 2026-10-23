/*
 * The closeout checklist (spec §10: a project isn't financially closed while
 * invoices, settlements or closeout actions remain, unless an authorised
 * override is recorded). Agreed with Nishan on 2026-10-23.
 */

export const CLOSEOUT_ITEMS = [
  { key: "INVOICES_ISSUED", label: "All client invoices issued" },
  { key: "PAYMENTS_COLLECTED", label: "Client payments collected" },
  { key: "VENDOR_BILLS_RECEIVED", label: "Vendor bills received" },
  { key: "CREW_SETTLED", label: "Crew settled" },
  { key: "EQUIPMENT_RETURNED", label: "Equipment returned" },
  { key: "EXPENSES_RECONCILED", label: "Expenses reconciled" },
  { key: "FINAL_REPORT", label: "Final report filed" },
] as const;
export type CloseoutKey = (typeof CLOSEOUT_ITEMS)[number]["key"];

export type CloseoutRow = { key: CloseoutKey; doneAt: Date | null; notApplicable: boolean };

/** The items still open, in checklist order. */
export function outstandingCloseout(rows: CloseoutRow[]) {
  return CLOSEOUT_ITEMS.filter((item) => {
    const row = rows.find((r) => r.key === item.key);
    return !row || (!row.doneAt && !row.notApplicable);
  });
}
