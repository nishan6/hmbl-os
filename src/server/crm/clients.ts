import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { withUniqueConflict } from "@/server/db-errors";
import { recordAudit } from "@/server/audit/record";
import { diffChanges } from "@/server/audit/diff";
import { authorize, type Actor } from "@/server/permissions/authorize";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/parse";
import { normalizeClientName, websiteDomain } from "./normalize";
import {
  clientInput,
  contactInput,
  mergeInput,
  type ClientInput,
  type ContactInput,
} from "./schemas";

/*
 * Clients and contacts are group-wide master data: a CRM permission held for
 * any entity lets someone see and maintain them. What HMBL sells to a client
 * (opportunities, quotes) is entity-scoped and checked separately.
 */

const CLIENT_FIELDS = [
  "name",
  "legalName",
  "kind",
  "relationship",
  "industry",
  "website",
  "email",
  "phone",
  "taxIdType",
  "taxId",
  "addressLine1",
  "addressLine2",
  "city",
  "region",
  "postalCode",
  "countryCode",
  "currency",
  "invoiceCode",
  "ownerId",
  "notes",
  "status",
] as const;

const CONTACT_FIELDS = [
  "name",
  "jobTitle",
  "email",
  "phone",
  "isPrimary",
  "notes",
  "status",
] as const;

const TAX_ID_TAKEN = "Another active client already has this tax ID or invoice code.";

/** Refuses an invoice code another active client holds. */
async function assertInvoiceCodeFree(code: string | null, exceptId?: string) {
  if (!code) return;
  const holder = await db.client.findFirst({
    where: { invoiceCode: code, status: "ACTIVE", ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { name: true },
  });
  if (holder) {
    throw new ValidationError("Check the highlighted fields.", {
      invoiceCode: [`${holder.name} already uses ${code}`],
    });
  }
}

export type ClientListOptions = {
  search?: string;
  relationship?: "PROSPECT" | "CLIENT";
  includeArchived?: boolean;
};

export async function listClients(actor: Actor, options: ClientListOptions = {}) {
  authorize(actor, "crm.view");
  const search = options.search?.trim();
  return db.client.findMany({
    where: {
      ...(options.includeArchived ? {} : { status: "ACTIVE" }),
      ...(options.relationship ? { relationship: options.relationship } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { legalName: { contains: search, mode: "insensitive" } },
              { normalizedName: { contains: normalizeClientName(search) } },
              { taxId: { equals: search.toUpperCase() } },
              { contacts: { some: { name: { contains: search, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    include: {
      owner: { select: { name: true } },
      _count: { select: { contacts: { where: { status: "ACTIVE" } } } },
    },
    orderBy: { name: "asc" },
    take: 500,
  });
}

/** Active clients for pickers, with their active contacts. */
export async function listClientOptions(actor: Actor) {
  authorize(actor, "crm.view");
  return db.client.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      name: true,
      currency: true,
      contacts: {
        where: { status: "ACTIVE" },
        select: { id: true, name: true },
        orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
      },
    },
    orderBy: { name: "asc" },
  });
}

export async function getClient(actor: Actor, id: string) {
  authorize(actor, "crm.view");
  const client = await db.client.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, name: true } },
      mergedInto: { select: { id: true, name: true } },
      contacts: { orderBy: [{ status: "asc" }, { isPrimary: "desc" }, { name: "asc" }] },
    },
  });
  if (!client) throw new NotFoundError();
  return client;
}

/**
 * Active clients that look like the same organisation: the same name once
 * suffixes are ignored, the same tax ID, or the same website domain.
 */
export async function findPossibleDuplicates(
  actor: Actor,
  candidate: { name: string; taxId?: string | null; website?: string | null },
  excludeId?: string,
) {
  authorize(actor, "crm.view");
  const domain = websiteDomain(candidate.website);
  const or: Prisma.ClientWhereInput[] = [{ normalizedName: normalizeClientName(candidate.name) }];
  if (candidate.taxId) or.push({ taxId: candidate.taxId.toUpperCase() });
  if (domain) or.push({ website: { contains: domain, mode: "insensitive" } });
  const matches = await db.client.findMany({
    where: { status: "ACTIVE", OR: or, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, name: true, normalizedName: true, website: true, taxId: true, city: true },
    take: 10,
  });
  const name = normalizeClientName(candidate.name);
  const taxId = candidate.taxId?.toUpperCase();
  // `contains` on the website over-matches (a.com inside ba.com), so confirm each hit.
  return matches
    .filter(
      (m) =>
        m.normalizedName === name ||
        (taxId && m.taxId === taxId) ||
        (domain && websiteDomain(m.website) === domain),
    )
    .slice(0, 5);
}

async function assertOwner(ownerId: string | null | undefined) {
  if (!ownerId) return;
  const user = await db.user.findUnique({ where: { id: ownerId } });
  if (!user || user.status !== "ACTIVE") {
    throw new ValidationError("Check the highlighted fields.", { ownerId: ["Unknown user"] });
  }
}

export async function createClient(actor: Actor, input: ClientInput) {
  authorize(actor, "crm.create");
  const { allowDuplicate, ...data } = parseInput(clientInput, input);
  await assertOwner(data.ownerId);
  await assertInvoiceCodeFree(data.invoiceCode);
  if (!allowDuplicate) {
    const duplicates = await findPossibleDuplicates(actor, data);
    if (duplicates.length) {
      throw new ValidationError("This looks like a client that already exists.", {
        duplicate: duplicates.map((d) => d.name),
      });
    }
  }
  return withUniqueConflict(TAX_ID_TAKEN, () =>
    db.$transaction(async (tx) => {
      const client = await tx.client.create({
        data: {
          ...data,
          // No owner given: the creator. An explicit null means nobody.
          ownerId: data.ownerId === undefined ? actor.id : data.ownerId,
          normalizedName: normalizeClientName(data.name),
        },
      });
      await recordAudit(tx, actor, {
        action: "client.created",
        targetType: "client",
        targetId: client.id,
        changes: diffChanges(null, client, CLIENT_FIELDS),
        metadata: allowDuplicate ? { duplicateConfirmed: true } : undefined,
      });
      return client;
    }),
  );
}

export async function updateClient(actor: Actor, id: string, input: ClientInput) {
  authorize(actor, "crm.edit");
  const before = await getClient(actor, id);
  if (before.status !== "ACTIVE") throw new ConflictError("Restore this client before editing it.");
  // Duplicate checks only apply when creating.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { allowDuplicate, ...data } = parseInput(clientInput, input);
  await assertOwner(data.ownerId);
  await assertInvoiceCodeFree(data.invoiceCode, id);
  return withUniqueConflict(TAX_ID_TAKEN, () =>
    db.$transaction(async (tx) => {
      const after = await tx.client.update({
        where: { id },
        data: {
          ...data,
          ownerId: data.ownerId === undefined ? before.ownerId : data.ownerId,
          normalizedName: normalizeClientName(data.name),
        },
      });
      const changes = diffChanges(before, after, CLIENT_FIELDS);
      if (changes) {
        await recordAudit(tx, actor, {
          action: "client.updated",
          targetType: "client",
          targetId: id,
          changes,
        });
      }
      return after;
    }),
  );
}

export async function setClientArchived(
  actor: Actor,
  id: string,
  archived: boolean,
  reason?: string,
) {
  authorize(actor, "crm.archive");
  const before = await getClient(actor, id);
  if (!archived && before.mergedIntoId) {
    throw new ConflictError("This client was merged into another and can't be restored.");
  }
  const status = archived ? "ARCHIVED" : "ACTIVE";
  if (before.status === status) return before;
  return withUniqueConflict(TAX_ID_TAKEN, () =>
    db.$transaction(async (tx) => {
      const after = await tx.client.update({ where: { id }, data: { status } });
      await recordAudit(tx, actor, {
        action: archived ? "client.archived" : "client.restored",
        targetType: "client",
        targetId: id,
        changes: diffChanges(before, after, ["status"]),
        metadata: reason ? { reason } : undefined,
      });
      return after;
    }),
  );
}

/**
 * Tables that point at a client, moved to the surviving record on merge.
 * Modules that add a clientId column add it here.
 */
type Move = (tx: Prisma.TransactionClient, from: string, to: string) => Promise<{ count: number }>;
const CLIENT_REFERENCES: Record<string, Move> = {
  contact: (tx, from, to) =>
    tx.contact.updateMany({ where: { clientId: from }, data: { clientId: to } }),
  opportunity: (tx, from, to) =>
    tx.opportunity.updateMany({ where: { clientId: from }, data: { clientId: to } }),
  crmActivity: (tx, from, to) =>
    tx.crmActivity.updateMany({ where: { clientId: from }, data: { clientId: to } }),
  quote: (tx, from, to) =>
    tx.quote.updateMany({ where: { clientId: from }, data: { clientId: to } }),
  project: (tx, from, to) =>
    tx.project.updateMany({ where: { clientId: from }, data: { clientId: to } }),
};

/**
 * Merges a duplicate into the client to keep. Everything that pointed at the
 * duplicate moves across, the duplicate is archived with a pointer to the
 * survivor, and both records get an audit event. Nothing is deleted.
 */
export async function mergeClient(actor: Actor, duplicateId: string, input: unknown) {
  authorize(actor, "crm.edit");
  authorize(actor, "crm.archive");
  const { targetId, reason } = parseInput(mergeInput, input);
  if (targetId === duplicateId) {
    throw new ValidationError("Check the highlighted fields.", {
      targetId: ["Choose a different client"],
    });
  }
  const [duplicate, target] = await Promise.all([
    getClient(actor, duplicateId),
    getClient(actor, targetId),
  ]);
  if (duplicate.status !== "ACTIVE" || target.status !== "ACTIVE") {
    throw new ConflictError("Both clients must be active to merge.");
  }
  return db.$transaction(async (tx) => {
    // The survivor keeps its own primary contact.
    if (target.contacts.some((c) => c.isPrimary && c.status === "ACTIVE")) {
      await tx.contact.updateMany({ where: { clientId: duplicateId }, data: { isPrimary: false } });
    }
    const moved: Record<string, number> = {};
    for (const [table, move] of Object.entries(CLIENT_REFERENCES)) {
      moved[table] = (await move(tx, duplicateId, targetId)).count;
    }
    // Carry over details the survivor is missing.
    const fill: Prisma.ClientUpdateInput = {};
    for (const field of [
      "legalName",
      "website",
      "email",
      "phone",
      "industry",
      "taxIdType",
      "taxId",
    ] as const) {
      if (!target[field] && duplicate[field]) fill[field] = duplicate[field];
    }
    if (duplicate.relationship === "CLIENT") fill.relationship = "CLIENT";
    const archivedDuplicate = await tx.client.update({
      where: { id: duplicateId },
      data: { status: "ARCHIVED", mergedIntoId: targetId },
    });
    const after = await tx.client.update({ where: { id: targetId }, data: fill });
    await recordAudit(tx, actor, {
      action: "client.merged",
      targetType: "client",
      targetId: duplicateId,
      changes: diffChanges(duplicate, archivedDuplicate, ["status", "mergedIntoId"]),
      metadata: { reason, mergedInto: targetId, moved },
    });
    await recordAudit(tx, actor, {
      action: "client.merge_received",
      targetType: "client",
      targetId,
      changes: diffChanges(target, after, CLIENT_FIELDS),
      metadata: { reason, mergedFrom: duplicateId, moved },
    });
    return after;
  });
}

// ─── Contacts ────────────────────────────────────────────────────────────────

async function activeClient(actor: Actor, clientId: string) {
  const client = await getClient(actor, clientId);
  if (client.status !== "ACTIVE") throw new ConflictError("This client is archived.");
  return client;
}

/** Clears the client's current primary contact when another becomes primary. */
async function releasePrimary(tx: Prisma.TransactionClient, clientId: string, exceptId?: string) {
  await tx.contact.updateMany({
    where: { clientId, isPrimary: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
    data: { isPrimary: false },
  });
}

export async function createContact(actor: Actor, clientId: string, input: ContactInput) {
  authorize(actor, "crm.create");
  const client = await activeClient(actor, clientId);
  const data = parseInput(contactInput, input);
  const isPrimary = data.isPrimary || !client.contacts.some((c) => c.status === "ACTIVE");
  return db.$transaction(async (tx) => {
    if (isPrimary) await releasePrimary(tx, clientId);
    const contact = await tx.contact.create({ data: { ...data, isPrimary, clientId } });
    await recordAudit(tx, actor, {
      action: "contact.created",
      targetType: "client",
      targetId: clientId,
      changes: diffChanges(null, contact, CONTACT_FIELDS),
      metadata: { contactId: contact.id },
    });
    return contact;
  });
}

export async function updateContact(actor: Actor, contactId: string, input: ContactInput) {
  authorize(actor, "crm.edit");
  const before = await db.contact.findUnique({ where: { id: contactId } });
  if (!before) throw new NotFoundError();
  await activeClient(actor, before.clientId);
  const data = parseInput(contactInput, input);
  return db.$transaction(async (tx) => {
    if (data.isPrimary) await releasePrimary(tx, before.clientId, contactId);
    const after = await tx.contact.update({
      where: { id: contactId },
      // Editing never demotes the primary contact; promoting another one does.
      data: { ...data, isPrimary: data.isPrimary || before.isPrimary },
    });
    const changes = diffChanges(before, after, CONTACT_FIELDS);
    if (changes) {
      await recordAudit(tx, actor, {
        action: "contact.updated",
        targetType: "client",
        targetId: before.clientId,
        changes,
        metadata: { contactId },
      });
    }
    return after;
  });
}

export async function setContactArchived(actor: Actor, contactId: string, archived: boolean) {
  authorize(actor, "crm.archive");
  const before = await db.contact.findUnique({ where: { id: contactId } });
  if (!before) throw new NotFoundError();
  await activeClient(actor, before.clientId);
  const status = archived ? "ARCHIVED" : "ACTIVE";
  if (before.status === status) return before;
  return db.$transaction(async (tx) => {
    const after = await tx.contact.update({
      where: { id: contactId },
      // An archived contact can't stay primary; a restored one comes back as secondary.
      data: { status, isPrimary: false },
    });
    await recordAudit(tx, actor, {
      action: archived ? "contact.archived" : "contact.restored",
      targetType: "client",
      targetId: before.clientId,
      changes: diffChanges(before, after, ["status", "isPrimary"]),
      metadata: { contactId },
    });
    return after;
  });
}

export async function setPrimaryContact(actor: Actor, contactId: string) {
  authorize(actor, "crm.edit");
  const before = await db.contact.findUnique({ where: { id: contactId } });
  if (!before) throw new NotFoundError();
  await activeClient(actor, before.clientId);
  if (before.status !== "ACTIVE") throw new ConflictError("Restore this contact first.");
  if (before.isPrimary) return before;
  return db.$transaction(async (tx) => {
    await releasePrimary(tx, before.clientId);
    const after = await tx.contact.update({ where: { id: contactId }, data: { isPrimary: true } });
    await recordAudit(tx, actor, {
      action: "contact.updated",
      targetType: "client",
      targetId: before.clientId,
      changes: diffChanges(before, after, ["isPrimary"]),
      metadata: { contactId },
    });
    return after;
  });
}
