import "server-only";
import type { PortalShareKind } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { canChangeRecordDocuments, resolveRecord } from "@/server/documents/records";
import { authorize, can, type Actor } from "@/server/permissions/authorize";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";

/*
 * Choosing what a client sees in the portal (docs/client-portal.md). Nothing
 * is visible until it is shared here, and sharing needs the right to send
 * that record to the client: a project needs projects.edit, a quotation
 * commercial.issue, a document documents.edit on its record.
 */

export type ShareTarget = { kind: PortalShareKind; id: string };

const column = { PROJECT: "projectId", QUOTE: "quoteId", DOCUMENT: "documentId" } as const;

/** Clients' documents, and documents on their projects and quotations, can be shared. */
const SHAREABLE_DOCUMENT_RECORDS = ["CLIENT", "PROJECT", "QUOTE"] as const;

/** The record, its client and whether the actor may share it. Not found if they can't see it. */
async function resolveTarget(actor: Actor, target: ShareTarget) {
  if (target.kind === "PROJECT") {
    const p = await db.project.findUnique({
      where: { id: target.id },
      select: { id: true, number: true, clientId: true, legalEntityId: true, status: true },
    });
    if (!p || !can(actor, "projects.view", { legalEntityId: p.legalEntityId })) {
      throw new NotFoundError();
    }
    const blocked = !p.clientId
      ? "An internal project has no client to share it with."
      : p.status === "CANCELLED"
        ? "A cancelled project can't be shared."
        : null;
    return {
      clientId: p.clientId,
      legalEntityId: p.legalEntityId,
      label: `project ${p.number}`,
      canShare: can(actor, "projects.edit", { legalEntityId: p.legalEntityId }),
      blocked,
    };
  }
  if (target.kind === "QUOTE") {
    const q = await db.quote.findUnique({
      where: { id: target.id },
      select: {
        id: true,
        number: true,
        clientId: true,
        legalEntityId: true,
        versions: { where: { issuedAt: { not: null } }, select: { id: true }, take: 1 },
      },
    });
    if (!q || !can(actor, "commercial.view", { legalEntityId: q.legalEntityId })) {
      throw new NotFoundError();
    }
    return {
      clientId: q.clientId,
      legalEntityId: q.legalEntityId,
      label: `quotation ${q.number}`,
      canShare: can(actor, "commercial.issue", { legalEntityId: q.legalEntityId }),
      blocked: q.versions.length ? null : "Issue the quotation before sharing it.",
    };
  }
  const d = await db.recordDocument.findUnique({ where: { id: target.id } });
  if (!d) throw new NotFoundError();
  const record = await resolveRecord(actor, { type: d.recordType, id: d.recordId });
  if (d.access === "RESTRICTED") throw new NotFoundError();
  if (!(SHAREABLE_DOCUMENT_RECORDS as readonly string[]).includes(d.recordType)) {
    throw new ValidationError("Only documents on a client, project or quotation can be shared.");
  }
  const clientId =
    d.recordType === "CLIENT"
      ? d.recordId
      : d.recordType === "PROJECT"
        ? (await db.project.findUniqueOrThrow({ where: { id: d.recordId } })).clientId
        : (await db.quote.findUniqueOrThrow({ where: { id: d.recordId } })).clientId;
  return {
    clientId,
    legalEntityId: record.legalEntityId,
    label: `document "${d.title}"`,
    canShare: canChangeRecordDocuments(actor, d.recordType, record.legalEntityId, "documents.edit"),
    blocked: !clientId
      ? "This document's project has no client."
      : d.archivedAt
        ? "An archived document can't be shared."
        : null,
  };
}

/** Every version of a document: a share of one is a share of the document. */
async function documentChain(id: string) {
  const ids = [id];
  let back = await db.recordDocument.findUnique({
    where: { id },
    select: { previousVersionId: true, nextVersion: { select: { id: true } } },
  });
  let forward = back?.nextVersion?.id;
  while (back?.previousVersionId) {
    ids.push(back.previousVersionId);
    back = await db.recordDocument.findUnique({
      where: { id: back.previousVersionId },
      select: { previousVersionId: true, nextVersion: { select: { id: true } } },
    });
  }
  while (forward) {
    ids.push(forward);
    const next = await db.recordDocument.findUnique({
      where: { id: forward },
      select: { nextVersion: { select: { id: true } } },
    });
    forward = next?.nextVersion?.id;
  }
  return ids;
}

async function liveShare(target: ShareTarget) {
  const where =
    target.kind === "DOCUMENT"
      ? { documentId: { in: await documentChain(target.id) } }
      : { [column[target.kind]]: target.id };
  return db.portalShare.findFirst({
    where: { ...where, revokedAt: null },
    include: { sharedBy: { select: { name: true } } },
  });
}

/** Whether a record is shared, and what the actor may do about it. */
export async function sharingFor(actor: Actor, target: ShareTarget) {
  const t = await resolveTarget(actor, target);
  const [share, accounts] = await Promise.all([
    liveShare(target),
    t.clientId ? db.portalAccount.count({ where: { clientId: t.clientId, status: "ACTIVE" } }) : 0,
  ]);
  return { share, accounts, canShare: t.canShare, blocked: t.blocked };
}

export async function shareWithClient(actor: Actor, target: ShareTarget) {
  const t = await resolveTarget(actor, target);
  if (!t.canShare) throw new ForbiddenError();
  if (t.blocked || !t.clientId) throw new ConflictError(t.blocked ?? "There's no client.");
  const clientId = t.clientId;
  if (await liveShare(target)) return;
  try {
    await db.$transaction(async (tx) => {
      const share = await tx.portalShare.create({
        data: {
          clientId,
          kind: target.kind,
          projectId: target.kind === "PROJECT" ? target.id : null,
          quoteId: target.kind === "QUOTE" ? target.id : null,
          documentId: target.kind === "DOCUMENT" ? target.id : null,
          sharedById: actor.id,
        },
      });
      await recordAudit(tx, actor, {
        action: "portal_share.created",
        targetType: "portal_share",
        targetId: share.id,
        legalEntityId: t.legalEntityId,
        metadata: { kind: target.kind, recordId: target.id, clientId: t.clientId, what: t.label },
      });
    });
  } catch (error) {
    // Someone else shared it at the same moment; the unique index kept one.
    if (await liveShare(target)) return;
    throw error;
  }
}

export async function stopSharing(actor: Actor, target: ShareTarget) {
  const t = await resolveTarget(actor, target);
  if (!t.canShare) throw new ForbiddenError();
  const share = await liveShare(target);
  if (!share) return;
  await db.$transaction(async (tx) => {
    const { count } = await tx.portalShare.updateMany({
      where: { id: share.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: actor.id },
    });
    if (!count) return;
    await recordAudit(tx, actor, {
      action: "portal_share.revoked",
      targetType: "portal_share",
      targetId: share.id,
      legalEntityId: t.legalEntityId,
      metadata: { kind: target.kind, recordId: target.id, clientId: t.clientId, what: t.label },
    });
  });
}

/** A shared project's portal side, for its page: documents and what the client sent. */
export async function projectPortalActivity(actor: Actor, projectId: string) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { legalEntityId: true },
  });
  if (!project) throw new NotFoundError();
  authorize(actor, "projects.view", { legalEntityId: project.legalEntityId });
  return db.portalSubmission.findMany({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: { account: { include: { user: { select: { name: true, email: true } } } } },
  });
}

/** Which of these documents are shared, by current id; a share of any version counts. */
export async function sharedDocumentIds(documents: { id: string; earlier: { id: string }[] }[]) {
  if (!documents.length) return new Set<string>();
  const versionOf = new Map<string, string>();
  for (const d of documents) {
    versionOf.set(d.id, d.id);
    for (const e of d.earlier) versionOf.set(e.id, d.id);
  }
  const shares = await db.portalShare.findMany({
    where: { documentId: { in: [...versionOf.keys()] }, revokedAt: null },
    select: { documentId: true },
  });
  return new Set(shares.map((s) => versionOf.get(s.documentId!)!));
}

/**
 * For a record's documents list: which are shared with the client, and
 * whether the actor may change that. Null where documents can't be shared.
 */
export async function documentSharing(
  actor: Actor,
  record: { type: string; id: string; legalEntityId: string | null },
  documents: { id: string; earlier: { id: string }[] }[],
) {
  if (!(SHAREABLE_DOCUMENT_RECORDS as readonly string[]).includes(record.type)) return null;
  if (record.type === "PROJECT") {
    const p = await db.project.findUnique({ where: { id: record.id }, select: { clientId: true } });
    if (!p?.clientId) return null;
  }
  return {
    canShare: canChangeRecordDocuments(
      actor,
      record.type as (typeof SHAREABLE_DOCUMENT_RECORDS)[number],
      record.legalEntityId,
      "documents.edit",
    ),
    shared: await sharedDocumentIds(documents),
  };
}

/** The client's own answer to a quotation version in the portal, with its evidence. */
export async function portalResponseFor(actor: Actor, versionId: string) {
  const response = await db.quotePortalResponse.findUnique({
    where: { versionId },
    include: {
      user: { select: { name: true, email: true } },
      version: { select: { quote: { select: { legalEntityId: true } } } },
    },
  });
  if (!response) return null;
  authorize(actor, "commercial.view", { legalEntityId: response.version.quote.legalEntityId });
  const { version: _v, ...rest } = response;
  void _v;
  return rest;
}
