import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { authorize, type Actor } from "@/server/permissions/authorize";
import { discardFile, readFile, writeFile } from "@/server/storage/files";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/parse";
import { requiredText } from "@/lib/validation";
import {
  cleanFileName,
  contentTypeFor,
  DOCUMENT_CATEGORIES,
  isBlocked,
  type DocumentCategory,
} from "./document-rules";
import { assertChangeable, loadProject, lockProject } from "./projects";
import { optionalId } from "./schemas";

/*
 * Project documents (spec §17). Metadata is in `project_documents`; the bytes
 * are streamed to disk (src/server/storage/files.ts) with no size limit
 * (Nishan, 2026-10-23). Uploading a new version keeps the old one. Documents
 * are archived with a reason, never deleted.
 */

const invalid = (field: string, message: string) =>
  new ValidationError("Check the highlighted fields.", { [field]: [message] });

const uploadInput = z.object({
  category: z.enum(Object.keys(DOCUMENT_CATEGORIES) as [DocumentCategory, ...DocumentCategory[]], {
    message: "Choose a category",
  }),
  title: z.string().trim().max(200).nullish(),
  fileName: requiredText(1000),
  contentType: z.string().nullish(),
  previousVersionId: optionalId,
});
export type UploadInput = z.input<typeof uploadInput>;

/** The current version of each document, with its earlier versions. */
export async function listDocuments(actor: Actor, projectId: string) {
  await loadProject(actor, projectId);
  const all = await db.projectDocument.findMany({
    where: { projectId },
    orderBy: [{ uploadedAt: "desc" }],
    include: { uploadedBy: { select: { name: true } } },
  });
  const current = all.filter((d) => !d.supersededAt);
  const earlier = (doc: (typeof all)[number]) => {
    const chain = [];
    let id = doc.previousVersionId;
    while (id) {
      const prev = all.find((d) => d.id === id);
      if (!prev) break;
      chain.push(prev);
      id = prev.previousVersionId;
    }
    return chain;
  };
  return current.map((doc) => ({ ...doc, earlier: earlier(doc) }));
}

/**
 * Streams an upload to disk and records it. The project's permission and
 * state are checked before any bytes are written, and again when saving.
 */
export async function uploadDocument(
  actor: Actor,
  projectId: string,
  raw: UploadInput,
  body: ReadableStream<Uint8Array> | null,
) {
  const project = await loadProject(actor, projectId);
  authorize(actor, "projects.edit", { legalEntityId: project.legalEntityId });
  assertChangeable(project);
  const input = parseInput(uploadInput, raw);
  const fileName = cleanFileName(input.fileName);
  if (!fileName) throw invalid("file", "Choose a file");
  if (isBlocked(fileName)) {
    throw invalid("file", "Programs and scripts can't be uploaded. Zip them first if needed.");
  }
  if (!body) throw invalid("file", "Choose a file");

  const id = randomUUID();
  const storageKey = `projects/${projectId}/${id}`;
  const { sizeBytes, sha256 } = await writeFile(storageKey, body);
  try {
    if (sizeBytes === 0n) throw invalid("file", "The file is empty");
    return await db.$transaction(async (tx) => {
      assertChangeable(await lockProject(tx, projectId));
      let version = 1;
      if (input.previousVersionId) {
        const previous = await tx.projectDocument.findUnique({
          where: { id: input.previousVersionId },
        });
        if (!previous || previous.projectId !== projectId) throw new NotFoundError();
        if (previous.supersededAt || previous.archivedAt) {
          throw new ConflictError("Upload the new version against the current document.");
        }
        await tx.projectDocument.update({
          where: { id: previous.id },
          data: { supersededAt: new Date() },
        });
        version = previous.version + 1;
      }
      const doc = await tx.projectDocument.create({
        data: {
          id,
          projectId,
          category: input.category,
          title: input.title || fileName,
          fileName,
          contentType: contentTypeFor(fileName, input.contentType ?? null),
          sizeBytes,
          sha256,
          storageKey,
          version,
          previousVersionId: input.previousVersionId,
          uploadedById: actor.id,
        },
      });
      await recordAudit(tx, actor, {
        action: "document.uploaded",
        targetType: "project",
        targetId: projectId,
        legalEntityId: project.legalEntityId,
        metadata: {
          documentId: doc.id,
          title: doc.title,
          fileName,
          category: doc.category,
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

/** A document's record and file, for someone who can see the project. */
export async function openDocument(actor: Actor, id: string) {
  const doc = await db.projectDocument.findUnique({ where: { id } });
  if (!doc) throw new NotFoundError();
  await loadProject(actor, doc.projectId);
  return { doc, file: await readFile(doc.storageKey) };
}

export async function archiveDocument(actor: Actor, id: string, raw: { reason?: string | null }) {
  const doc = await db.projectDocument.findUnique({ where: { id } });
  if (!doc) throw new NotFoundError();
  const project = await loadProject(actor, doc.projectId);
  authorize(actor, "projects.edit", { legalEntityId: project.legalEntityId });
  const { reason } = parseInput(z.object({ reason: requiredText(500) }), raw);
  return db.$transaction(async (tx) => {
    assertChangeable(await lockProject(tx, project.id));
    const current = await tx.projectDocument.findUniqueOrThrow({ where: { id } });
    if (current.archivedAt) throw new ConflictError("This document is already archived.");
    const after = await tx.projectDocument.update({
      where: { id },
      data: { archivedAt: new Date(), archiveReason: reason },
    });
    await recordAudit(tx, actor, {
      action: "document.archived",
      targetType: "project",
      targetId: project.id,
      legalEntityId: project.legalEntityId,
      metadata: { documentId: id, title: doc.title, reason },
    });
    return after;
  });
}
