import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DocumentRecordType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { authorize, can, type Actor } from "@/server/permissions/authorize";
import { discardFile, readFile, writeFile } from "@/server/storage/files";
import { lockProject } from "@/server/projects/projects";
import { isLocked } from "@/server/projects/lifecycle";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/parse";
import { requiredText } from "@/lib/validation";
import { optionalId } from "@/server/projects/schemas";
import {
  cleanFileName,
  contentTypeFor,
  DOCUMENT_CATEGORIES,
  forcedRestricted,
  isBlocked,
  retainUntil,
  type DocumentCategory,
} from "@/server/projects/document-rules";
import {
  assertCanAttach,
  canChangeRecordDocuments,
  canSeeRestricted,
  documentFilter,
  RECORD_TYPES,
  recordHref,
  recordLabels,
  resolveRecord,
  type RecordRef,
  type ResolvedRecord,
} from "./records";

/*
 * Documents on business records (spec §17). Metadata is in `documents`; the
 * bytes are streamed to disk (src/server/storage/files.ts) with no size limit
 * (Nishan, 2026-10-23). Uploading a new version keeps the old one. Documents
 * are archived with a reason, never deleted.
 */

const invalid = (field: string, message: string) =>
  new ValidationError("Check the highlighted fields.", { [field]: [message] });

const recordTypes = Object.keys(RECORD_TYPES) as [DocumentRecordType, ...DocumentRecordType[]];

export const recordRefInput = z.object({
  type: z.enum(recordTypes, { message: "Unknown record" }),
  id: z.uuid({ message: "Unknown record" }),
});

const uploadInput = z.object({
  category: z.enum(Object.keys(DOCUMENT_CATEGORIES) as [DocumentCategory, ...DocumentCategory[]], {
    message: "Choose a category",
  }),
  title: z.string().trim().max(200).nullish(),
  fileName: requiredText(1000),
  contentType: z.string().nullish(),
  restricted: z
    .union([z.boolean(), z.string()])
    .nullish()
    .transform((v) => v === true || v === "true" || v === "on"),
  previousVersionId: optionalId,
});
export type UploadInput = z.input<typeof uploadInput>;

type Row = Prisma.RecordDocumentGetPayload<{ include: { uploadedBy: { select: { name: true } } } }>;

/** Earlier versions of each current document, newest first. */
function withHistory(all: Row[]) {
  const byId = new Map(all.map((d) => [d.id, d]));
  return all
    .filter((d) => !d.supersededAt)
    .map((doc) => {
      const earlier: Row[] = [];
      let id = doc.previousVersionId;
      while (id) {
        const prev = byId.get(id);
        if (!prev) break;
        earlier.push(prev);
        id = prev.previousVersionId;
      }
      return { ...doc, earlier };
    });
}

/**
 * A record's documents, current versions with their history, plus what the
 * actor may do. RESTRICTED documents are left out for people without
 * documents.view_sensitive; `hidden` says how many.
 */
export async function listRecordDocuments(actor: Actor, ref: RecordRef) {
  const record = await resolveRecord(actor, parseInput(recordRefInput, ref));
  const restricted = canSeeRestricted(actor, record.legalEntityId);
  const all = await db.recordDocument.findMany({
    where: { recordType: record.type, recordId: record.id },
    orderBy: [{ uploadedAt: "desc" }],
    include: { uploadedBy: { select: { name: true } } },
  });
  const visible = restricted ? all : all.filter((d) => d.access === "STANDARD");
  const canAttach =
    canChangeRecordDocuments(actor, record.type, record.legalEntityId) && !record.lockedReason;
  return {
    record,
    documents: withHistory(visible),
    hidden: withHistory(all).length - withHistory(visible).length,
    canUpload: canAttach,
    canArchive:
      canChangeRecordDocuments(actor, record.type, record.legalEntityId, "documents.edit") &&
      !record.lockedReason,
    canRestrict: canAttach && restricted,
  };
}

export type LibraryFilters = {
  search?: string;
  category?: DocumentCategory;
  recordType?: DocumentRecordType;
  archived?: boolean;
};

/** Every current document the actor may see, across records, newest first. */
export async function listLibrary(actor: Actor, filters: LibraryFilters = {}) {
  authorize(actor, "documents.view");
  const q = filters.search?.trim();
  const rows = await db.recordDocument.findMany({
    where: {
      AND: [
        documentFilter(actor),
        { supersededAt: null },
        filters.archived ? { archivedAt: { not: null } } : { archivedAt: null },
        filters.category ? { category: filters.category } : {},
        filters.recordType ? { recordType: filters.recordType } : {},
        q
          ? {
              OR: [
                { title: { contains: q, mode: "insensitive" } },
                { fileName: { contains: q, mode: "insensitive" } },
                { project: { number: { contains: q, mode: "insensitive" } } },
                { project: { name: { contains: q, mode: "insensitive" } } },
              ],
            }
          : {},
      ],
    },
    include: {
      uploadedBy: { select: { name: true } },
      legalEntity: { select: { code: true } },
      project: { select: { id: true, number: true, name: true } },
    },
    orderBy: { uploadedAt: "desc" },
    take: 300,
  });
  const labels = await recordLabels(rows.map((d) => ({ type: d.recordType, id: d.recordId })));
  return rows.map((d) => ({
    ...d,
    href: recordHref(d.recordType, d.recordId),
    recordLabel: labels.get(`${d.recordType}:${d.recordId}`) ?? RECORD_TYPES[d.recordType].label,
  }));
}

/**
 * Streams an upload to disk and records it. Permission and the record's
 * state are checked before any bytes are written, and again when saving.
 */
export async function uploadDocument(
  actor: Actor,
  ref: RecordRef,
  raw: UploadInput,
  body: ReadableStream<Uint8Array> | null,
) {
  const record = await resolveRecord(actor, parseInput(recordRefInput, ref));
  assertCanAttach(actor, record);
  const input = parseInput(uploadInput, raw);
  const restricted = input.restricted || forcedRestricted(input.category);
  if (restricted && !canSeeRestricted(actor, record.legalEntityId)) {
    if (forcedRestricted(input.category)) {
      throw invalid("category", "Only people with sensitive document access can add these.");
    }
    throw new ForbiddenError();
  }
  const fileName = cleanFileName(input.fileName);
  if (!fileName) throw invalid("file", "Choose a file");
  if (isBlocked(fileName)) {
    throw invalid("file", "Programs and scripts can't be uploaded. Zip them first if needed.");
  }
  if (!body) throw invalid("file", "Choose a file");

  const id = randomUUID();
  const storageKey = `${storageFolder(record)}/${id}`;
  const { sizeBytes, sha256 } = await writeFile(storageKey, body);
  try {
    if (sizeBytes === 0n) throw invalid("file", "The file is empty");
    return await db.$transaction(async (tx) => {
      await recheck(tx, record);
      let version = 1;
      if (input.previousVersionId) {
        const previous = await tx.recordDocument.findUnique({
          where: { id: input.previousVersionId },
        });
        if (!previous || previous.recordType !== record.type || previous.recordId !== record.id) {
          throw new NotFoundError();
        }
        if (previous.access === "RESTRICTED" && !canSeeRestricted(actor, record.legalEntityId)) {
          throw new NotFoundError();
        }
        if (previous.supersededAt || previous.archivedAt) {
          throw new ConflictError("Upload the new version against the current document.");
        }
        await tx.recordDocument.update({
          where: { id: previous.id },
          data: { supersededAt: new Date() },
        });
        version = previous.version + 1;
      }
      const now = new Date();
      const doc = await tx.recordDocument.create({
        data: {
          id,
          recordType: record.type,
          recordId: record.id,
          legalEntityId: record.legalEntityId,
          projectId: record.projectId,
          category: input.category,
          access: restricted ? "RESTRICTED" : "STANDARD",
          title: input.title || fileName,
          fileName,
          contentType: contentTypeFor(fileName, input.contentType ?? null),
          sizeBytes,
          sha256,
          storageKey,
          version,
          previousVersionId: input.previousVersionId,
          retainUntil: retainUntil(input.category, now),
          uploadedById: actor.id,
          uploadedAt: now,
        },
      });
      await recordAudit(tx, actor, {
        action: "document.uploaded",
        ...auditTarget(record),
        metadata: {
          documentId: doc.id,
          // A restricted document's title can itself be sensitive.
          title: restricted ? null : doc.title,
          fileName: restricted ? null : fileName,
          category: doc.category,
          access: doc.access,
          version,
          sizeBytes: sizeBytes.toString(),
          sha256,
        },
      });
      return doc;
    });
  } catch (error) {
    await discardFile(storageKey);
    throw error;
  }
}

/** Project files stay where they always were; other records' files go under documents/. */
function storageFolder(record: ResolvedRecord) {
  return record.type === "PROJECT" ? `projects/${record.id}` : `documents/${record.id}`;
}

function auditTarget(record: ResolvedRecord) {
  return {
    targetType: record.type.toLowerCase(),
    targetId: record.id,
    legalEntityId: record.legalEntityId,
  };
}

/** Inside the write: a project must still be open (locked against a concurrent close). */
async function recheck(tx: Prisma.TransactionClient, record: ResolvedRecord) {
  if (record.type !== "PROJECT") return;
  const project = await lockProject(tx, record.id);
  if (isLocked(project.status)) {
    throw new ConflictError("This project is closed, so it can't be changed.");
  }
}

/** A document the actor may see, or not found. */
async function loadDocument(actor: Actor, id: string) {
  const doc = await db.recordDocument.findUnique({ where: { id } });
  if (!doc) throw new NotFoundError();
  const record = await resolveRecord(actor, { type: doc.recordType, id: doc.recordId });
  if (doc.access === "RESTRICTED" && !canSeeRestricted(actor, record.legalEntityId)) {
    throw new NotFoundError();
  }
  return { doc, record };
}

/** A document's record and file, for someone who can see it. */
export async function openDocument(actor: Actor, id: string) {
  const { doc } = await loadDocument(actor, id);
  return { doc, file: await readFile(doc.storageKey) };
}

export async function archiveDocument(actor: Actor, id: string, raw: { reason?: string | null }) {
  const { doc, record } = await loadDocument(actor, id);
  if (!canChangeRecordDocuments(actor, record.type, record.legalEntityId, "documents.edit")) {
    throw new ForbiddenError();
  }
  if (record.lockedReason) throw new ConflictError(record.lockedReason);
  const { reason } = parseInput(z.object({ reason: requiredText(500) }), raw);
  return db.$transaction(async (tx) => {
    await recheck(tx, record);
    const current = await tx.recordDocument.findUniqueOrThrow({ where: { id } });
    if (current.archivedAt) throw new ConflictError("This document is already archived.");
    const after = await tx.recordDocument.update({
      where: { id },
      data: { archivedAt: new Date(), archiveReason: reason },
    });
    await recordAudit(tx, actor, {
      action: "document.archived",
      ...auditTarget(record),
      metadata: {
        documentId: id,
        title: doc.access === "RESTRICTED" ? null : doc.title,
        reason,
        retainUntil: doc.retainUntil?.toISOString().slice(0, 10) ?? null,
      },
    });
    return after;
  });
}

/** For pages: whether the actor may open the document library at all. */
export function canOpenLibrary(actor: Actor) {
  return can(actor, "documents.view");
}
