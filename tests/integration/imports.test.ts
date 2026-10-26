import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createClient } from "@/server/crm/clients";
import { createCrewMember } from "@/server/crew/members";
import {
  commitImport,
  correctRow,
  decideAll,
  decideRow,
  discardImport,
  dryRun,
  getImport,
  importKindsFor,
  listImports,
  problemRowsCsv,
  saveMapping,
  stageImport,
} from "@/server/imports/batches";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { makeActor } from "../helpers/actors";
import { ASSAM_GSTIN } from "../helpers/finance";

const csv = (...lines: string[]) => lines.join("\n") + "\n";

const row = (d: Awaited<ReturnType<typeof getImport>>, line: number) =>
  d.rows.find((r) => r.line === line)!;

describe("staging a file", () => {
  it("guesses the mapping, checks every row and writes nothing", async () => {
    const sales = await makeActor("sales");
    await createClient(sales, { name: "Brightside Events", countryCode: "IN", currency: "INR" });
    const batch = await stageImport(sales, {
      kind: "CLIENTS",
      fileName: "clients.csv",
      text: csv(
        "Client Name,GSTIN,City,State,Country,Currency,E-mail",
        `Lotus Weddings,${ASSAM_GSTIN},Guwahati,Assam,IN,INR,hello@lotus.test`,
        "Bad Email Co,,Pune,Maharashtra,IN,INR,not-an-email",
        "Brightside Events Pvt Ltd,,Mumbai,Maharashtra,IN,INR,",
        "Lotus Weddings,,Shillong,Meghalaya,IN,INR,",
      ),
    });
    const d = await getImport(sales, batch.id);
    expect(d.batch.headers).toEqual([
      "Client Name",
      "GSTIN",
      "City",
      "State",
      "Country",
      "Currency",
      "E-mail",
    ]);
    expect(d.mapping).toMatchObject({ name: 0, taxId: 1, city: 2, region: 3, countryCode: 4 });
    expect(row(d, 2)).toMatchObject({ status: "VALID", fields: { taxId: ASSAM_GSTIN } });
    expect(row(d, 3)).toMatchObject({ status: "INVALID", errors: { email: [expect.any(String)] } });
    // "Pvt Ltd" is ignored when comparing names.
    expect(row(d, 4)).toMatchObject({
      status: "DUPLICATE",
      matchLabel: "Brightside Events",
      matchReason: "Same name",
      decision: null,
    });
    expect(row(d, 5)).toMatchObject({
      status: "INVALID",
      errors: { _row: ["The same record as line 2 of this file"] },
    });
    expect(d.plan).toMatchObject({ create: 1, rejected: 2, undecided: 1, total: 4 });
    expect(await db.client.count()).toBe(1);
    expect(
      await db.auditEvent.count({ where: { action: "import.staged", targetId: batch.id } }),
    ).toBe(1);
  });

  it("refuses files it can't read and kinds the user may not import", async () => {
    const sales = await makeActor("sales");
    expect(importKindsFor(sales)).toEqual(["CLIENTS"]);
    await expect(
      stageImport(sales, { kind: "CLIENTS", fileName: "x.csv", text: "Name\n" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      stageImport(sales, { kind: "CREW", fileName: "x.csv", text: csv("Name,Type", "A,Staff") }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const viewer = await makeActor("viewer");
    await expect(listImports(viewer)).rejects.toBeInstanceOf(ForbiddenError);
    const batch = await stageImport(sales, {
      kind: "CLIENTS",
      fileName: "x.csv",
      text: csv("Name,Country,Currency", "A,IN,INR"),
    });
    const coordinator = await makeActor("crew_coordinator");
    await expect(getImport(coordinator, batch.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("mapping and correcting", () => {
  it("rejects every row until required fields have a column or a value", async () => {
    const sales = await makeActor("sales");
    const batch = await stageImport(sales, {
      kind: "CLIENTS",
      fileName: "x.csv",
      text: csv("Organisation,Town", "Kite Media,Delhi", "Orbit Sound,Kolkata"),
    });
    let d = await getImport(sales, batch.id);
    expect(d.missing.map((f) => f.key)).toEqual(["name", "countryCode", "currency"]);
    expect(d.rows.every((r) => r.status === "INVALID")).toBe(true);
    expect(row(d, 2).errors._row![0]).toMatch(/Name, Country, Currency/);

    await saveMapping(sales, batch.id, {
      name: 0,
      city: 1,
      countryCode: { value: "IN" },
      currency: { value: "INR" },
      unknown: 3,
    });
    d = await getImport(sales, batch.id);
    expect(d.mapping).toEqual({
      name: 0,
      city: 1,
      countryCode: { value: "IN" },
      currency: { value: "INR" },
    });
    expect(d.plan).toMatchObject({ create: 2, rejected: 0 });
  });

  it("lets a person correct a row, and keeps the correction with the row", async () => {
    const sales = await makeActor("sales");
    const batch = await stageImport(sales, {
      kind: "CLIENTS",
      fileName: "x.csv",
      text: csv("Name,Country,Currency", "Kite Media,India,INR"),
    });
    let d = await getImport(sales, batch.id);
    expect(row(d, 2)).toMatchObject({
      status: "INVALID",
      errors: { countryCode: expect.any(Array) },
    });
    await correctRow(sales, row(d, 2).id, { countryCode: "IN" });
    d = await getImport(sales, batch.id);
    expect(row(d, 2)).toMatchObject({ status: "VALID", edits: { countryCode: "IN" } });
    expect(row(d, 2).values).toEqual(["Kite Media", "India", "INR"]);
  });
});

describe("committing", () => {
  it("needs a decision on every duplicate, then writes through the services with audit", async () => {
    const sales = await makeActor("sales");
    const existing = await createClient(sales, {
      name: "Brightside Events",
      countryCode: "IN",
      currency: "INR",
    });
    const batch = await stageImport(sales, {
      kind: "CLIENTS",
      fileName: "clients.csv",
      text: csv(
        "Name,Country,Currency,City",
        "Kite Media,IN,INR,Delhi",
        "Brightside Events,IN,INR,Mumbai",
        "Broken,IN,RUPEES,",
      ),
    });
    let check = await dryRun(sales, batch.id);
    expect(check).toMatchObject({ ready: false, plan: { create: 1, undecided: 1, rejected: 1 } });
    await expect(commitImport(sales, batch.id)).rejects.toBeInstanceOf(ConflictError);
    expect(await db.client.count()).toBe(1);

    const d = await getImport(sales, batch.id);
    await decideRow(sales, row(d, 3).id, { decision: "UPDATE" });
    check = await dryRun(sales, batch.id);
    expect(check).toMatchObject({ ready: true, plan: { create: 1, update: 1, rejected: 1 } });

    const done = await commitImport(sales, batch.id);
    expect(done.status).toBe("COMMITTED");
    expect(done.summary).toEqual({ CREATED: 1, UPDATED: 1, REJECTED: 1 });
    const after = await getImport(sales, batch.id);
    const created = await db.client.findUniqueOrThrow({ where: { id: row(after, 2).recordId! } });
    expect(created).toMatchObject({ name: "Kite Media", city: "Delhi", ownerId: sales.id });
    // Updating fills in what the file has and keeps the rest.
    expect(await db.client.findUniqueOrThrow({ where: { id: existing.id } })).toMatchObject({
      name: "Brightside Events",
      city: "Mumbai",
    });
    expect(row(after, 4)).toMatchObject({
      outcome: "REJECTED",
      outcomeMessage: expect.any(String),
    });
    expect(await db.auditEvent.count({ where: { action: "client.created" } })).toBe(2);
    expect(await db.auditEvent.count({ where: { action: "client.updated" } })).toBe(1);
    expect(
      await db.auditEvent.findFirst({ where: { action: "import.committed", targetId: batch.id } }),
    ).toMatchObject({ metadata: expect.objectContaining({ CREATED: 1, UPDATED: 1 }) });

    // Committed batches don't change and can't be committed twice.
    await expect(commitImport(sales, batch.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(saveMapping(sales, batch.id, {})).rejects.toBeInstanceOf(ConflictError);

    const problems = await problemRowsCsv(sales, batch.id);
    expect(problems.fileName).toBe("clients-problems.csv");
    expect(problems.csv.split("\r\n")[0]).toBe("Name,Country,Currency,City,Line,Problem");
    expect(problems.csv).toContain("Broken,IN,RUPEES,,4,");
  });

  it("creates a second record only when a person says so, and never beside a unique one", async () => {
    const warehouse = await makeActor("warehouse");
    const category = await db.equipmentCategory.create({ data: { name: "Lighting" } });
    const existing = await db.equipmentItem.create({
      data: {
        sku: "MH-01",
        name: "Moving head",
        categoryId: category.id,
        tracking: "SERIALISED",
        currency: "INR",
      },
    });
    const batch = await stageImport(warehouse, {
      kind: "EQUIPMENT",
      fileName: "kit.csv",
      text: csv(
        "SKU,Name,Category,Tracking,Currency,Day rate",
        "mh-01,Robe MegaPointe,lighting,Serialised,INR,4500",
        "CBL-16A,16A cable 10 m,Power,Quantity,INR,50",
      ),
    });
    const d = await getImport(warehouse, batch.id);
    expect(row(d, 2)).toMatchObject({
      status: "DUPLICATE",
      matchReason: "Same SKU",
      matchCanCreate: false,
    });
    expect(row(d, 3)).toMatchObject({
      status: "INVALID",
      errors: { category: ["No active category called “Power”"] },
    });
    await expect(decideRow(warehouse, row(d, 2).id, { decision: "CREATE" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    // "Create all" leaves rows that can't be created for a person.
    await decideAll(warehouse, batch.id, { decision: "CREATE" });
    expect((await dryRun(warehouse, batch.id)).plan.undecided).toBe(1);
    await decideRow(warehouse, row(d, 2).id, { decision: "UPDATE" });
    await commitImport(warehouse, batch.id);
    expect(await db.equipmentItem.findUniqueOrThrow({ where: { id: existing.id } })).toMatchObject({
      name: "Robe MegaPointe",
      rentalDayRateMinor: 450_000n,
    });
  });

  it("matches crew on email and keeps fields the file leaves blank", async () => {
    const coordinator = await makeActor("crew_coordinator");
    const member = await createCrewMember(coordinator, {
      name: "Nila Das",
      kind: "FREELANCER",
      email: "nila@example.test",
      baseCity: "Guwahati",
      skills: "Rigging",
    });
    const batch = await stageImport(coordinator, {
      kind: "CREW",
      fileName: "crew.csv",
      text: csv(
        "Full name,Type,Email,Skills",
        'N. Das,Freelancer,NILA@example.test,"Rigging, Lighting operator"',
      ),
    });
    const d = await getImport(coordinator, batch.id);
    expect(row(d, 2)).toMatchObject({ status: "DUPLICATE", matchReason: "Same email" });
    await decideAll(coordinator, batch.id, { decision: "UPDATE" });
    await commitImport(coordinator, batch.id);
    expect(await db.crewMember.findUniqueOrThrow({ where: { id: member.id } })).toMatchObject({
      name: "N. Das",
      baseCity: "Guwahati",
      skills: ["Rigging", "Lighting operator"],
    });
  });

  it("keeps vendor TDS to Finance and only one commit at a time", async () => {
    const procurement = await makeActor("procurement");
    const batch = await stageImport(procurement, {
      kind: "VENDORS",
      fileName: "vendors.csv",
      text: csv("Vendor,Country,Currency,TDS section", "Truss Hire Co,IN,INR,194C"),
    });
    const d = await getImport(procurement, batch.id);
    expect(row(d, 2)).toMatchObject({
      status: "INVALID",
      errors: { tdsSection: ["Only Finance can set TDS; leave it blank"] },
    });
    await correctRow(procurement, row(d, 2).id, { tdsSection: "" });
    expect((await dryRun(procurement, batch.id)).ready).toBe(true);

    await db.importBatch.update({
      where: { id: batch.id },
      data: { status: "COMMITTING", commitStartedAt: new Date() },
    });
    await expect(commitImport(procurement, batch.id)).rejects.toBeInstanceOf(ConflictError);
    // A commit left hanging for over 15 minutes can be resumed.
    await db.importBatch.update({
      where: { id: batch.id },
      data: { commitStartedAt: new Date(Date.now() - 20 * 60_000) },
    });
    expect((await commitImport(procurement, batch.id)).summary).toEqual({ CREATED: 1 });
    expect(await db.vendor.findFirstOrThrow()).toMatchObject({
      name: "Truss Hire Co",
      paymentTermsDays: 30,
    });
  });

  it("can be discarded before commit", async () => {
    const sales = await makeActor("sales");
    const batch = await stageImport(sales, {
      kind: "CLIENTS",
      fileName: "x.csv",
      text: csv("Name,Country,Currency", "A,IN,INR"),
    });
    await discardImport(sales, batch.id);
    await expect(commitImport(sales, batch.id)).rejects.toBeInstanceOf(ConflictError);
    expect(await db.client.count()).toBe(0);
  });
});
