import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  archiveDocument,
  listDocuments,
  openDocument,
  uploadDocument,
} from "@/server/projects/documents";
import { setCloseoutItem } from "@/server/projects/closeout";
import { changeProjectStatus } from "@/server/projects/projects";
import { ConflictError, ForbiddenError } from "@/lib/errors";
import { makeActor } from "../helpers/actors";
import { makeAcceptedProject } from "../helpers/projects";

const body = (text: string) => new Blob([text]).stream();

async function readText(stream: ReadableStream<Uint8Array>) {
  return new Response(stream).text();
}

describe("project documents", () => {
  it("streams a file to disk, keeps versions and serves the right one", async () => {
    const { project } = await makeAcceptedProject();
    const pm = await makeActor("project_manager");
    const v1 = await uploadDocument(
      pm,
      project.id,
      { category: "TECHNICAL", fileName: "rider.pdf", title: "Tech rider" },
      body("version one"),
    );
    expect(v1).toMatchObject({ version: 1, sizeBytes: 11n, contentType: "application/pdf" });
    expect(v1.sha256).toMatch(/^[0-9a-f]{64}$/);

    const v2 = await uploadDocument(
      pm,
      project.id,
      { category: "TECHNICAL", fileName: "rider-v2.pdf", previousVersionId: v1.id },
      body("version two!"),
    );
    expect(v2.version).toBe(2);
    await expect(
      uploadDocument(
        pm,
        project.id,
        { category: "TECHNICAL", fileName: "x.pdf", previousVersionId: v1.id },
        body("again"),
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    const docs = await listDocuments(pm, project.id);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.earlier.map((d) => d.id)).toEqual([v1.id]);
    const viewer = await makeActor("viewer");
    const opened = await openDocument(viewer, v1.id);
    expect(await readText(opened.file.stream)).toBe("version one");

    const audit = await db.auditEvent.findMany({
      where: { targetId: project.id, action: "document.uploaded" },
    });
    expect(audit).toHaveLength(2);
  });

  it("refuses programs, empty files and people who can't edit", async () => {
    const { project } = await makeAcceptedProject();
    const pm = await makeActor("project_manager");
    const viewer = await makeActor("viewer");
    const meta = { category: "OTHER" as const, fileName: "tool.exe" };
    await expect(uploadDocument(pm, project.id, meta, body("MZ"))).rejects.toMatchObject({
      fieldErrors: { file: [expect.stringContaining("Programs")] },
    });
    await expect(
      uploadDocument(pm, project.id, { ...meta, fileName: "empty.txt" }, body("")),
    ).rejects.toMatchObject({ fieldErrors: { file: ["The file is empty"] } });
    await expect(
      uploadDocument(viewer, project.id, { ...meta, fileName: "a.txt" }, body("a")),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.projectDocument.count()).toBe(0);
  });

  it("archives with a reason and never deletes or rewrites", async () => {
    const { project } = await makeAcceptedProject();
    const pm = await makeActor("project_manager");
    const doc = await uploadDocument(
      pm,
      project.id,
      { category: "CONTRACT", fileName: "contract.pdf" },
      body("signed"),
    );
    await expect(archiveDocument(pm, doc.id, {})).rejects.toMatchObject({ code: "VALIDATION" });
    await archiveDocument(pm, doc.id, { reason: "Wrong client" });
    await expect(archiveDocument(pm, doc.id, { reason: "Again" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(
      db.projectDocument.update({ where: { id: doc.id }, data: { title: "Changed" } }),
    ).rejects.toThrow(/can't be changed/);
    await expect(db.projectDocument.delete({ where: { id: doc.id } })).rejects.toThrow(
      /can't be deleted/,
    );
  });
});

describe("closeout", () => {
  async function toFinancialClose() {
    const made = await makeAcceptedProject();
    const owner = await makeActor("owner");
    const pm = await makeActor("project_manager");
    await changeProjectStatus(owner, made.project.id, { to: "COMPLETED" });
    await changeProjectStatus(owner, made.project.id, { to: "FINANCIAL_CLOSE" });
    return { ...made, owner, pm };
  }

  it("needs a reason to close with items open, and records the override", async () => {
    const { project, owner } = await toFinancialClose();
    await expect(changeProjectStatus(owner, project.id, { to: "CLOSED" })).rejects.toMatchObject({
      fieldErrors: { reason: [expect.stringContaining("all client invoices issued")] },
    });
    await changeProjectStatus(owner, project.id, {
      to: "CLOSED",
      reason: "Client in liquidation; written off",
    });
    const change = await db.projectStatusChange.findFirstOrThrow({
      where: { projectId: project.id, toStatus: "CLOSED" },
    });
    expect(change.override).toBe(true);
    const audit = await db.auditEvent.findFirstOrThrow({
      where: { targetId: project.id, action: "project.status_changed" },
      orderBy: { occurredAt: "desc" },
    });
    expect(audit.metadata).toMatchObject({ override: true });
  });

  it("closes without an override once every item is done or not applicable", async () => {
    const { project, owner, pm } = await toFinancialClose();
    await expect(
      setCloseoutItem(pm, project.id, { key: "FINAL_REPORT", state: "done" }),
    ).rejects.toThrow(/closeout report/);
    await uploadDocument(
      pm,
      project.id,
      { category: "CLOSEOUT_REPORT", fileName: "report.pdf" },
      body("report"),
    );
    await expect(
      setCloseoutItem(pm, project.id, { key: "CREW_SETTLED", state: "not_applicable" }),
    ).rejects.toMatchObject({ fieldErrors: { note: [expect.any(String)] } });
    for (const key of [
      "INVOICES_ISSUED",
      "PAYMENTS_COLLECTED",
      "VENDOR_BILLS_RECEIVED",
      "EQUIPMENT_RETURNED",
      "EXPENSES_RECONCILED",
      "FINAL_REPORT",
    ] as const) {
      await setCloseoutItem(pm, project.id, { key, state: "done" });
    }
    await setCloseoutItem(pm, project.id, {
      key: "CREW_SETTLED",
      state: "not_applicable",
      note: "No freelance crew",
    });
    await changeProjectStatus(owner, project.id, { to: "CLOSED" });
    const change = await db.projectStatusChange.findFirstOrThrow({
      where: { projectId: project.id, toStatus: "CLOSED" },
    });
    expect(change.override).toBe(false);
  });
});
