import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  allocateNumber,
  addDefaultNumberingSchemes,
  archiveNumberingScheme,
  createNumberingScheme,
  listNumberingSchemes,
  previewNumbers,
} from "@/server/numbering/service";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { makeActor, makeScopedActor } from "../helpers/actors";
import { makeEntity } from "../helpers/organisation";
import { createLegalEntity } from "@/server/organisation/service";
import { DOCUMENT_TYPES } from "@/server/numbering/document-types";

async function setup(
  pattern = "Q-{FY}-{SEQ:4}",
  resetPolicy: "NEVER" | "YEARLY" | "FISCAL_YEARLY" | "MONTHLY" = "FISCAL_YEARLY",
) {
  const owner = await makeActor("owner");
  const entity = await makeEntity({ code: "HMBL-IN" });
  const scheme = await createNumberingScheme(owner, {
    documentType: "quotation",
    legalEntityId: entity.id,
    pattern,
    resetPolicy,
  });
  return { owner, entity, scheme };
}

const issue = (legalEntityId: string, date?: Date) =>
  db.$transaction((tx) => allocateNumber(tx, { documentType: "quotation", legalEntityId, date }));

describe("numbering schemes", () => {
  it("creates a scheme, audits it and previews numbers", async () => {
    const { owner, entity, scheme } = await setup();
    expect(scheme.pattern).toBe("Q-{FY}-{SEQ:4}");
    expect(await db.auditEvent.count({ where: { action: "numbering_scheme.created" } })).toBe(1);
    const preview = await previewNumbers(owner, {
      documentType: "quotation",
      legalEntityId: entity.id,
      pattern: "{ENTITY}-{SEQ:3}",
      resetPolicy: "NEVER",
      startAt: 41,
    });
    expect(preview).toEqual(["HMBL-IN-041", "HMBL-IN-042", "HMBL-IN-043"]);
  });

  it("rejects bad patterns and unknown document types", async () => {
    const owner = await makeActor("owner");
    const entity = await makeEntity();
    const base = { legalEntityId: entity.id, resetPolicy: "YEARLY" as const };
    await expect(
      createNumberingScheme(owner, { ...base, documentType: "quotation", pattern: "Q-{SEQ:4}" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createNumberingScheme(owner, {
        ...base,
        documentType: "spaceship",
        pattern: "Q-{YYYY}-{SEQ:4}",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("allows one active scheme per document type per entity", async () => {
    const { owner, entity, scheme } = await setup();
    const again = {
      documentType: "quotation",
      legalEntityId: entity.id,
      pattern: "QT-{FY}-{SEQ:4}",
      resetPolicy: "FISCAL_YEARLY" as const,
    };
    await expect(createNumberingScheme(owner, again)).rejects.toBeInstanceOf(ConflictError);
    await archiveNumberingScheme(owner, scheme.id, "New format");
    await expect(createNumberingScheme(owner, again)).resolves.toMatchObject({ status: "ACTIVE" });
  });

  it("is configured per entity", async () => {
    const india = await makeEntity({ code: "IN-1" });
    const uk = await makeEntity({ code: "UK-1" });
    const admin = await makeScopedActor("administrator", india.id);
    const input = (legalEntityId: string) => ({
      documentType: "project",
      legalEntityId,
      pattern: "PRJ-{SEQ:5}",
      resetPolicy: "NEVER" as const,
    });
    await createNumberingScheme(admin, input(india.id));
    await expect(createNumberingScheme(admin, input(uk.id))).rejects.toBeInstanceOf(NotFoundError);
    expect(await listNumberingSchemes(admin)).toHaveLength(1);

    const sales = await makeActor("sales");
    await expect(createNumberingScheme(sales, input(uk.id))).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("allocateNumber", () => {
  it("issues consecutive numbers", async () => {
    const { entity } = await setup();
    const date = new Date("2026-10-22T10:00:00Z");
    expect((await issue(entity.id, date)).number).toBe("Q-2026-27-0001");
    expect((await issue(entity.id, date)).number).toBe("Q-2026-27-0002");
  });

  it("restarts each fiscal year, in the entity's time zone", async () => {
    const { entity } = await setup();
    expect((await issue(entity.id, new Date("2026-03-31T17:00:00Z"))).number).toBe(
      "Q-2025-26-0001",
    );
    // 00:30 on 1 April in Mumbai.
    expect((await issue(entity.id, new Date("2026-03-31T19:00:00Z"))).number).toBe(
      "Q-2026-27-0001",
    );
    expect((await issue(entity.id, new Date("2026-03-31T17:30:00Z"))).number).toBe(
      "Q-2025-26-0002",
    );
  });

  it("returns the number when the saving transaction rolls back", async () => {
    const { entity } = await setup("Q-{SEQ:4}", "NEVER");
    await issue(entity.id);
    await expect(
      db.$transaction(async (tx) => {
        await allocateNumber(tx, { documentType: "quotation", legalEntityId: entity.id });
        throw new Error("document failed to save");
      }),
    ).rejects.toThrow("document failed to save");
    expect((await issue(entity.id)).number).toBe("Q-0002");
  });

  it("never issues the same number twice under concurrency", async () => {
    const { entity } = await setup("Q-{SEQ:4}", "NEVER");
    const results = await Promise.all(Array.from({ length: 20 }, () => issue(entity.id)));
    const sequences = results.map((r) => r.sequence).sort((a, b) => a - b);
    expect(sequences).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it("continues a migrated series from startAt", async () => {
    const owner = await makeActor("owner");
    const entity = await makeEntity();
    await createNumberingScheme(owner, {
      documentType: "quotation",
      legalEntityId: entity.id,
      pattern: "Q-{SEQ:4}",
      resetPolicy: "NEVER",
      startAt: 1501,
    });
    expect((await issue(entity.id)).number).toBe("Q-1501");
    expect((await issue(entity.id)).number).toBe("Q-1502");
  });

  it("refuses when the entity has no active scheme", async () => {
    const { owner, entity, scheme } = await setup();
    await archiveNumberingScheme(owner, scheme.id);
    await expect(issue(entity.id)).rejects.toBeInstanceOf(ConflictError);
    const other = await makeEntity();
    await expect(issue(other.id)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("default number formats", () => {
  const typeCount = Object.keys(DOCUMENT_TYPES).length;

  it("gives a new entity a format for every document type, with India's April fiscal year", async () => {
    const owner = await makeActor("owner");
    const entity = await createLegalEntity(owner, {
      code: "NEW-IN",
      legalName: "New India Pvt Ltd",
      countryCode: "IN",
      baseCurrency: "INR",
      timezone: "Asia/Kolkata",
    });
    const schemes = await db.numberingScheme.findMany({ where: { legalEntityId: entity.id } });
    expect(schemes).toHaveLength(typeCount);
    expect(schemes.every((s) => s.fiscalYearStartMonth === 4 && !s.isDemo)).toBe(true);
    expect(
      await db.auditEvent.count({
        where: { action: "numbering_scheme.created", legalEntityId: entity.id },
      }),
    ).toBe(typeCount);
    await expect(issue(entity.id, new Date("2026-10-23T00:00:00Z"))).resolves.toMatchObject({
      number: "Q-2627-0001",
    });
  });

  it("fills in only the missing formats for an existing entity", async () => {
    const { owner, entity } = await setup();
    const added = await addDefaultNumberingSchemes(owner, entity.id);
    expect(added).not.toContain("quotation");
    expect(added).toHaveLength(typeCount - 1);
    expect(await addDefaultNumberingSchemes(owner, entity.id)).toEqual([]);
  });

  it("needs configuration rights in that entity", async () => {
    const entity = await makeEntity();
    const admin = await makeScopedActor("sales", entity.id);
    await expect(addDefaultNumberingSchemes(admin, entity.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
