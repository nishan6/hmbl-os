import "server-only";
import type { DocumentRecordType } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { can, entityFilter, type Actor } from "@/server/permissions/authorize";
import type { Permission } from "@/server/permissions/catalog";
import { isLocked, PROJECT_STATUSES } from "@/server/projects/lifecycle";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";

/*
 * The records documents attach to (docs/documents.md). Seeing a record's
 * documents needs `documents.view` plus permission to see the record itself;
 * attaching or archiving needs `documents.create` or `documents.edit` plus
 * permission to change the record. Entity-scoped records are checked against
 * their legal entity; clients, vendors, crew and equipment are shared.
 */

type Rule = {
  label: string;
  /** Permissions that let someone see the record; any one is enough. */
  view: Permission[];
  /** Permissions that let someone change the record; any one is enough. */
  edit: Permission[];
  /** Whether the record carries a legal entity. */
  scoped: boolean;
};

export const RECORD_TYPES: Record<DocumentRecordType, Rule> = {
  PROJECT: { label: "Project", view: ["projects.view"], edit: ["projects.edit"], scoped: true },
  CLIENT: { label: "Client", view: ["crm.view"], edit: ["crm.edit"], scoped: false },
  QUOTE: { label: "Quotation", view: ["commercial.view"], edit: ["commercial.edit"], scoped: true },
  VENDOR: {
    label: "Vendor",
    view: ["procurement.view", "finance.view"],
    edit: ["procurement.edit", "finance.edit"],
    scoped: false,
  },
  PURCHASE_ORDER: {
    label: "Purchase order",
    view: ["procurement.view"],
    edit: ["procurement.edit"],
    scoped: true,
  },
  VENDOR_BILL: {
    label: "Vendor bill",
    view: ["finance.view"],
    edit: ["finance.edit"],
    scoped: true,
  },
  SALES_INVOICE: { label: "Invoice", view: ["finance.view"], edit: ["finance.edit"], scoped: true },
  CREW_MEMBER: { label: "Crew member", view: ["crew.view"], edit: ["crew.edit"], scoped: false },
  EQUIPMENT_ITEM: {
    label: "Equipment",
    view: ["equipment.view"],
    edit: ["equipment.edit"],
    scoped: false,
  },
  TRAVEL_REQUEST: {
    label: "Trip",
    view: ["logistics.view"],
    edit: ["logistics.edit"],
    scoped: true,
  },
  SHIPMENT: {
    label: "Logistics movement",
    view: ["logistics.view"],
    edit: ["logistics.edit"],
    scoped: true,
  },
};

export type RecordRef = { type: DocumentRecordType; id: string };

/** A record as documents see it: where it lives, what it is called, who owns it. */
export type ResolvedRecord = RecordRef & {
  label: string;
  href: string;
  legalEntityId: string | null;
  projectId: string | null;
  /** Why documents can't be added right now, if they can't. */
  lockedReason: string | null;
};

/** Where a record's page is. */
export function recordHref(type: DocumentRecordType, id: string) {
  switch (type) {
    case "PROJECT":
      return `/projects/${id}/documents`;
    case "CLIENT":
      return `/crm/clients/${id}`;
    case "QUOTE":
      return `/quotes/${id}`;
    case "VENDOR":
      return `/procurement/vendors/${id}`;
    case "PURCHASE_ORDER":
      return `/procurement/${id}`;
    case "VENDOR_BILL":
      return `/finance/bills/${id}`;
    case "SALES_INVOICE":
      return `/finance/invoices/${id}`;
    case "CREW_MEMBER":
      return `/crew/${id}`;
    case "EQUIPMENT_ITEM":
      return `/equipment/${id}`;
    case "TRAVEL_REQUEST":
      return `/logistics/travel/${id}`;
    case "SHIPMENT":
      return `/logistics/shipments/${id}`;
  }
}

async function find(type: DocumentRecordType, id: string) {
  const base = { href: recordHref(type, id), lockedReason: null as string | null };
  switch (type) {
    case "PROJECT": {
      const p = await db.project.findUnique({ where: { id } });
      if (!p) return null;
      return {
        ...base,
        label: `${p.number} · ${p.name}`,
        legalEntityId: p.legalEntityId,
        projectId: p.id,
        lockedReason: isLocked(p.status)
          ? `This project is ${PROJECT_STATUSES[p.status].toLowerCase()}, so it can't be changed.`
          : null,
      };
    }
    case "CLIENT": {
      const c = await db.client.findUnique({ where: { id }, select: { name: true } });
      return c && { ...base, label: c.name, legalEntityId: null, projectId: null };
    }
    case "QUOTE": {
      const q = await db.quote.findUnique({
        where: { id },
        select: { number: true, title: true, legalEntityId: true },
      });
      return (
        q && {
          ...base,
          label: `${q.number} · ${q.title}`,
          legalEntityId: q.legalEntityId,
          projectId: null,
        }
      );
    }
    case "VENDOR": {
      const v = await db.vendor.findUnique({ where: { id }, select: { name: true } });
      return v && { ...base, label: v.name, legalEntityId: null, projectId: null };
    }
    case "PURCHASE_ORDER": {
      const o = await db.purchaseOrder.findUnique({
        where: { id },
        select: {
          number: true,
          legalEntityId: true,
          projectId: true,
          vendor: { select: { name: true } },
        },
      });
      return (
        o && {
          ...base,
          label: `${o.number ?? "Draft order"} · ${o.vendor.name}`,
          legalEntityId: o.legalEntityId,
          projectId: o.projectId,
        }
      );
    }
    case "VENDOR_BILL": {
      const b = await db.vendorBill.findUnique({
        where: { id },
        select: {
          number: true,
          vendorInvoiceNumber: true,
          legalEntityId: true,
          vendor: { select: { name: true } },
        },
      });
      return (
        b && {
          ...base,
          label: `${b.number ?? "Draft bill"} · ${b.vendor.name} ${b.vendorInvoiceNumber}`.trim(),
          legalEntityId: b.legalEntityId,
          projectId: null,
        }
      );
    }
    case "SALES_INVOICE": {
      const i = await db.salesInvoice.findUnique({
        where: { id },
        select: {
          number: true,
          legalEntityId: true,
          projectId: true,
          client: { select: { name: true } },
        },
      });
      return (
        i && {
          ...base,
          label: `${i.number ?? "Draft invoice"} · ${i.client.name}`,
          legalEntityId: i.legalEntityId,
          projectId: i.projectId,
        }
      );
    }
    case "CREW_MEMBER": {
      const c = await db.crewMember.findUnique({ where: { id }, select: { name: true } });
      return c && { ...base, label: c.name, legalEntityId: null, projectId: null };
    }
    case "EQUIPMENT_ITEM": {
      const e = await db.equipmentItem.findUnique({
        where: { id },
        select: { name: true, sku: true },
      });
      return e && { ...base, label: `${e.name} (${e.sku})`, legalEntityId: null, projectId: null };
    }
    case "TRAVEL_REQUEST": {
      const t = await db.travelRequest.findUnique({
        where: { id },
        select: { number: true, title: true, legalEntityId: true, projectId: true },
      });
      return (
        t && {
          ...base,
          label: t.number ? `${t.number} · ${t.title}` : t.title,
          legalEntityId: t.legalEntityId,
          projectId: t.projectId,
        }
      );
    }
    case "SHIPMENT": {
      const s = await db.shipment.findUnique({
        where: { id },
        select: { title: true, legalEntityId: true, projectId: true },
      });
      return (
        s && { ...base, label: s.title, legalEntityId: s.legalEntityId, projectId: s.projectId }
      );
    }
  }
}

function allowed(actor: Actor, permissions: Permission[], legalEntityId: string | null) {
  const scope = legalEntityId ? { legalEntityId } : undefined;
  return permissions.some((p) => can(actor, p, scope));
}

/** Whether the actor may see this record's documents. */
export function canSeeRecordDocuments(
  actor: Actor,
  type: DocumentRecordType,
  legalEntityId: string | null,
) {
  const scope = legalEntityId ? { legalEntityId } : undefined;
  return (
    can(actor, "documents.view", scope) && allowed(actor, RECORD_TYPES[type].view, legalEntityId)
  );
}

/** Whether the actor may add documents to (or archive documents on) this record. */
export function canChangeRecordDocuments(
  actor: Actor,
  type: DocumentRecordType,
  legalEntityId: string | null,
  permission: "documents.create" | "documents.edit" = "documents.create",
) {
  const scope = legalEntityId ? { legalEntityId } : undefined;
  return (
    canSeeRecordDocuments(actor, type, legalEntityId) &&
    can(actor, permission, scope) &&
    allowed(actor, RECORD_TYPES[type].edit, legalEntityId)
  );
}

/** Whether the actor may see RESTRICTED documents for a record in this entity. */
export function canSeeRestricted(actor: Actor, legalEntityId: string | null) {
  return can(actor, "documents.view_sensitive", legalEntityId ? { legalEntityId } : undefined);
}

/** Loads a record the actor can see documents for; anything else is not found. */
export async function resolveRecord(actor: Actor, ref: RecordRef): Promise<ResolvedRecord> {
  const found = await find(ref.type, ref.id);
  if (!found || !canSeeRecordDocuments(actor, ref.type, found.legalEntityId)) {
    throw new NotFoundError();
  }
  return { ...ref, ...found };
}

/** Fails unless the actor may add documents to the record now. */
export function assertCanAttach(actor: Actor, record: ResolvedRecord) {
  if (!canChangeRecordDocuments(actor, record.type, record.legalEntityId)) {
    throw new ForbiddenError();
  }
  if (record.lockedReason) throw new ConflictError(record.lockedReason);
}

/**
 * A Prisma `where` limiting documents to records the actor can see, and
 * RESTRICTED ones to people with documents.view_sensitive.
 */
export function documentFilter(actor: Actor) {
  const types = (Object.keys(RECORD_TYPES) as DocumentRecordType[]).filter((t) =>
    canSeeRecordDocuments(actor, t, null),
  );
  return {
    OR: types.map((type) => {
      const rule = RECORD_TYPES[type];
      const scoped = rule.scoped
        ? [
            entityFilter(actor, "documents.view"),
            { OR: rule.view.map((p) => entityFilter(actor, p)) },
          ]
        : [];
      return { recordType: type, AND: scoped };
    }),
    AND: [
      {
        OR: [
          { access: "STANDARD" as const },
          ...(can(actor, "documents.view_sensitive")
            ? [{ legalEntityId: null }, entityFilter(actor, "documents.view_sensitive")]
            : []),
        ],
      },
    ],
  };
}

/** Names for many records at once, keyed `${type}:${id}`, for the library. */
export async function recordLabels(refs: RecordRef[]) {
  const ids = (type: DocumentRecordType) => [
    ...new Set(refs.filter((r) => r.type === type).map((r) => r.id)),
  ];
  const where = (type: DocumentRecordType) => ({ id: { in: ids(type) } });
  const [projects, clients, quotes, vendors, orders, bills, invoices, crew, items, trips, ships] =
    await Promise.all([
      db.project.findMany({
        where: where("PROJECT"),
        select: { id: true, number: true, name: true },
      }),
      db.client.findMany({ where: where("CLIENT"), select: { id: true, name: true } }),
      db.quote.findMany({ where: where("QUOTE"), select: { id: true, number: true, title: true } }),
      db.vendor.findMany({ where: where("VENDOR"), select: { id: true, name: true } }),
      db.purchaseOrder.findMany({
        where: where("PURCHASE_ORDER"),
        select: { id: true, number: true, vendor: { select: { name: true } } },
      }),
      db.vendorBill.findMany({
        where: where("VENDOR_BILL"),
        select: { id: true, number: true, vendor: { select: { name: true } } },
      }),
      db.salesInvoice.findMany({
        where: where("SALES_INVOICE"),
        select: { id: true, number: true, client: { select: { name: true } } },
      }),
      db.crewMember.findMany({ where: where("CREW_MEMBER"), select: { id: true, name: true } }),
      db.equipmentItem.findMany({
        where: where("EQUIPMENT_ITEM"),
        select: { id: true, name: true, sku: true },
      }),
      db.travelRequest.findMany({
        where: where("TRAVEL_REQUEST"),
        select: { id: true, number: true, title: true },
      }),
      db.shipment.findMany({ where: where("SHIPMENT"), select: { id: true, title: true } }),
    ]);
  const labels = new Map<string, string>();
  const put = (type: DocumentRecordType, id: string, label: string) =>
    labels.set(`${type}:${id}`, label);
  for (const r of projects) put("PROJECT", r.id, `${r.number} · ${r.name}`);
  for (const r of clients) put("CLIENT", r.id, r.name);
  for (const r of quotes) put("QUOTE", r.id, `${r.number} · ${r.title}`);
  for (const r of vendors) put("VENDOR", r.id, r.name);
  for (const r of orders)
    put("PURCHASE_ORDER", r.id, `${r.number ?? "Draft order"} · ${r.vendor.name}`);
  for (const r of bills) put("VENDOR_BILL", r.id, `${r.number ?? "Draft bill"} · ${r.vendor.name}`);
  for (const r of invoices) {
    put("SALES_INVOICE", r.id, `${r.number ?? "Draft invoice"} · ${r.client.name}`);
  }
  for (const r of crew) put("CREW_MEMBER", r.id, r.name);
  for (const r of items) put("EQUIPMENT_ITEM", r.id, `${r.name} (${r.sku})`);
  for (const r of trips)
    put("TRAVEL_REQUEST", r.id, r.number ? `${r.number} · ${r.title}` : r.title);
  for (const r of ships) put("SHIPMENT", r.id, r.title);
  return labels;
}
