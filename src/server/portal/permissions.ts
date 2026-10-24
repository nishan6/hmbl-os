import type { PortalKind } from "@/generated/prisma/enums";

/*
 * What a portal account may do (docs/portal.md). Separate from the internal
 * permission catalog on purpose: no internal permission ever applies to a
 * portal user, and no portal permission means anything inside HMBL OS.
 * Each is chosen per account when the person is invited.
 */

export const PORTAL_PERMISSIONS = {
  CLIENT: {
    "projects.view": "See the status and agreed milestones of projects shared with them",
    "quotes.respond": "See quotations shared with them, and accept or decline them",
    "invoices.view": "See invoices, what is due and how to pay",
    "documents.view": "Download documents shared with them",
    "requests.submit": "Send project information HMBL has asked for",
  },
  VENDOR: {
    "orders.view": "See purchase orders issued to them",
    "orders.confirm": "Confirm or decline purchase orders and bookings",
    "bills.submit": "Upload their invoices against purchase orders",
    "payments.view": "See whether their bills are approved and paid",
    "profile.edit": "Update their contact and compliance details",
  },
  FREELANCER: {
    "work.view": "See the work and call information they are booked for",
    "work.confirm": "Confirm or decline proposed bookings",
    "timesheets.submit": "Submit hours and days worked",
    "settlements.view": "See what they are owed and what has been paid",
    "profile.edit": "Update their contact details and certifications",
  },
} as const satisfies Record<PortalKind, Record<string, string>>;

export type PortalPermission<K extends PortalKind = PortalKind> =
  keyof (typeof PORTAL_PERMISSIONS)[K] & string;

/** Offered ticked when inviting. Seeing money is a deliberate choice. */
export const DEFAULT_PORTAL_PERMISSIONS: Record<PortalKind, string[]> = {
  CLIENT: ["projects.view", "quotes.respond", "documents.view", "requests.submit"],
  VENDOR: ["orders.view", "orders.confirm", "bills.submit", "profile.edit"],
  FREELANCER: ["work.view", "work.confirm", "timesheets.submit", "profile.edit"],
};

export const PORTAL_KIND_LABELS: Record<PortalKind, string> = {
  CLIENT: "Client",
  VENDOR: "Vendor",
  FREELANCER: "Freelancer",
};

export function isPortalPermission(kind: PortalKind, value: string) {
  return Object.hasOwn(PORTAL_PERMISSIONS[kind], value);
}
