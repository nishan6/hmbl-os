import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  archiveDocument,
  listLibrary,
  listRecordDocuments,
  openDocument,
  uploadDocument,
} from "@/server/documents/documents";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { makeActor, makeScopedActor } from "../helpers/actors";
import { makeVendor } from "../helpers/finance";
import { makeAcceptedProject } from "../helpers/projects";

const body = (text: string) => new Blob([text]).stream();

async function makeCrewMember() {
  return db.crewMember.create({
    data: { name: "Test Rigger", normalizedName: "test rigger", kind: "FREELANCER" },
  });
}

describe("documents across records", () => {
  it("attaches to a vendor for procurement and finance, not for sales", async () => {
    const vendor = await makeVendor();
    const procurement = await makeActor("procurement");
    const finance = await makeActor("finance");
    const sales = await makeActor("sales");
    const ref = { type: "VENDOR" as const, id: vendor.id };
    const doc = await uploadDocument(
      procurement,
      ref,
      { category: "COMPLIANCE", fileName: "msme-certificate.pdf" },
      body("MSME"),
    );
    expect(doc).toMatchObject({ recordType: "VENDOR", legalEntityId: null, projectId: null });
    expect(doc.storageKey).toBe(`documents/${vendor.id}/${doc.id}`);

    expect((await listRecordDocuments(finance, ref)).documents.map((d) => d.id)).toEqual([doc.id]);
    expect((await listLibrary(finance)).map((d) => d.id)).toContain(doc.id);
    await expect(listRecordDocuments(sales, ref)).rejects.toThrow(NotFoundError);
    await expect(openDocument(sales, doc.id)).rejects.toThrow(NotFoundError);
    expect((await listLibrary(sales)).map((d) => d.id)).not.toContain(doc.id);
    // Finance can see vendors but attaching needs documents.create and vendor edit rights.
    await expect(
      uploadDocument(sales, ref, { category: "OTHER", fileName: "a.pdf" }, body("a")),
    ).rejects.toThrow(NotFoundError);
  });

  it("keeps restricted documents to people with sensitive document access", async () => {
    const crew = await makeCrewMember();
    const owner = await makeActor("owner");
    const coordinator = await makeActor("crew_coordinator");
    const ref = { type: "CREW_MEMBER" as const, id: crew.id };
    await expect(
      uploadDocument(
        coordinator,
        ref,
        { category: "IDENTITY", fileName: "passport.pdf" },
        body("P"),
      ),
    ).rejects.toMatchObject({ fieldErrors: { category: [expect.any(String)] } });
    const passport = await uploadDocument(
      owner,
      ref,
      { category: "IDENTITY", fileName: "passport.pdf", title: "Passport A1234567" },
      body("P"),
    );
    expect(passport.access).toBe("RESTRICTED");
    const contract = await uploadDocument(
      coordinator,
      ref,
      { category: "CONTRACT", fileName: "freelance-agreement.pdf" },
      body("C"),
    );

    const seen = await listRecordDocuments(coordinator, ref);
    expect(seen.documents.map((d) => d.id)).toEqual([contract.id]);
    expect(seen.hidden).toBe(1);
    await expect(openDocument(coordinator, passport.id)).rejects.toThrow(NotFoundError);
    expect((await listLibrary(coordinator)).map((d) => d.id)).not.toContain(passport.id);
    expect((await listLibrary(owner)).map((d) => d.id)).toContain(passport.id);
    // Not even the title leaks into the audit log.
    const audit = await db.auditEvent.findFirstOrThrow({
      where: { targetId: crew.id, action: "document.uploaded" },
      orderBy: { occurredAt: "asc" },
    });
    expect(audit.metadata).toMatchObject({ title: null, fileName: null, access: "RESTRICTED" });

    // Archiving needs documents.edit, which the coordinator doesn't hold.
    await expect(archiveDocument(coordinator, contract.id, { reason: "Old" })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("scopes documents on entity records to that entity", async () => {
    const { entity, quote } = await makeAcceptedProject();
    const sales = await makeActor("sales");
    const ref = { type: "QUOTE" as const, id: quote.id };
    const doc = await uploadDocument(
      sales,
      ref,
      { category: "SIGNED_AGREEMENT", fileName: "signed-quote.pdf" },
      body("signed"),
    );
    expect(doc.legalEntityId).toBe(entity.id);
    expect(doc.retainUntil).not.toBeNull();
    expect(doc.retainUntil!.toISOString().slice(5, 10)).toBe("03-31");

    const inside = await makeScopedActor("owner", entity.id);
    const other = await makeAcceptedProject();
    const outside = await makeScopedActor("owner", other.entity.id);
    expect((await listLibrary(inside)).map((d) => d.id)).toContain(doc.id);
    expect((await listLibrary(outside)).map((d) => d.id)).not.toContain(doc.id);
    await expect(openDocument(outside, doc.id)).rejects.toThrow(NotFoundError);

    const filtered = await listLibrary(inside, {
      recordType: "QUOTE",
      category: "SIGNED_AGREEMENT",
    });
    expect(filtered.map((d) => d.id)).toEqual([doc.id]);
    expect(filtered[0]!.href).toBe(`/quotes/${quote.id}`);
    expect(await listLibrary(inside, { recordType: "VENDOR" })).toEqual([]);
  });
});
