import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  createClient,
  createContact,
  findPossibleDuplicates,
  getClient,
  listClients,
  mergeClient,
  setClientArchived,
  setContactArchived,
  setPrimaryContact,
  updateClient,
} from "@/server/crm/clients";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { makeActor, makeScopedActor } from "../helpers/actors";
import { makeEntity } from "../helpers/organisation";

const star = {
  name: "Star Sports India Pvt Ltd",
  countryCode: "in",
  currency: "inr",
  taxIdType: "gstin",
  taxId: "27aaaaa0000a1z5",
  website: "https://www.starsports.example",
};

describe("clients", () => {
  it("creates a prospect owned by its creator, normalising codes and tax IDs", async () => {
    const sales = await makeActor("sales");
    const client = await createClient(sales, star);
    expect(client).toMatchObject({
      relationship: "PROSPECT",
      ownerId: sales.id,
      countryCode: "IN",
      currency: "INR",
      taxIdType: "GSTIN",
      taxId: "27AAAAA0000A1Z5",
      normalizedName: "star sports",
    });
    const event = await db.auditEvent.findFirst({ where: { action: "client.created" } });
    expect(event).toMatchObject({ targetId: client.id, actorId: sales.id });
  });

  it("validates GSTINs, emails and websites", async () => {
    const sales = await makeActor("sales");
    for (const bad of [
      { taxId: "27AAAAA0000" },
      { taxIdType: null },
      { email: "not-an-email" },
      { website: "not a site" },
      { currency: "RUPEES" },
    ]) {
      await expect(createClient(sales, { ...star, ...bad })).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
  });

  it("warns about likely duplicates until the user confirms", async () => {
    const sales = await makeActor("sales");
    await createClient(sales, star);
    const again = { name: "STAR SPORTS", countryCode: "IN", currency: "INR" };
    const error = await createClient(sales, again).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors.duplicate).toEqual(["Star Sports India Pvt Ltd"]);

    await expect(createClient(sales, { ...again, allowDuplicate: true })).resolves.toBeDefined();
    const event = await db.auditEvent.findFirst({
      where: { action: "client.created" },
      orderBy: { occurredAt: "desc" },
    });
    expect(event?.metadata).toMatchObject({ duplicateConfirmed: true });
  });

  it("finds duplicates by website domain, but not by a domain that merely contains it", async () => {
    const sales = await makeActor("sales");
    await createClient(sales, { ...star, taxId: null, taxIdType: null, website: "ab.example" });
    const byDomain = await findPossibleDuplicates(sales, {
      name: "Other",
      website: "www.ab.example/x",
    });
    expect(byDomain).toHaveLength(1);
    const contained = await findPossibleDuplicates(sales, { name: "Other", website: "b.example" });
    expect(contained).toHaveLength(0);
  });

  it("refuses a second active client with the same tax ID, even when confirmed", async () => {
    const sales = await makeActor("sales");
    await createClient(sales, star);
    await expect(
      createClient(sales, { ...star, name: "Different Name", allowDuplicate: true }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("searches by name, normalised name, contact and tax ID", async () => {
    const sales = await makeActor("sales");
    const client = await createClient(sales, star);
    await createContact(sales, client.id, { name: "Asha Rao" });
    await createClient(sales, { name: "Other Co", countryCode: "IN", currency: "INR" });
    for (const search of ["star", "Star Sports", "asha", "27AAAAA0000A1Z5"]) {
      expect((await listClients(sales, { search })).map((c) => c.id)).toEqual([client.id]);
    }
  });

  it("audits only real changes on update", async () => {
    const sales = await makeActor("sales");
    const client = await createClient(sales, star);
    await updateClient(sales, client.id, { ...star, city: "Mumbai" });
    await updateClient(sales, client.id, { ...star, city: "Mumbai" });
    const updates = await db.auditEvent.findMany({ where: { action: "client.updated" } });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.changes).toEqual({ city: { from: null, to: "Mumbai" } });
  });

  it("is shared across entities: a sales user scoped to one entity can see and add clients", async () => {
    const entity = await makeEntity();
    const scoped = await makeScopedActor("sales", entity.id);
    const client = await createClient(scoped, star);
    const other = await makeActor("sales");
    await expect(getClient(other, client.id)).resolves.toMatchObject({ id: client.id });
  });

  it("enforces CRM permissions", async () => {
    const viewer = await makeActor("viewer");
    const pm = await makeActor("project_manager");
    await expect(createClient(viewer, star)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createClient(pm, star)).rejects.toBeInstanceOf(ForbiddenError);
    const client = await createClient(await makeActor("sales"), star);
    await expect(listClients(viewer)).resolves.toHaveLength(1);
    await expect(updateClient(viewer, client.id, star)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setClientArchived(pm, client.id, true)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("archives and restores, and won't edit an archived client", async () => {
    const sales = await makeActor("sales");
    const client = await createClient(sales, star);
    await setClientArchived(sales, client.id, true, "No longer trading");
    expect(await listClients(sales)).toHaveLength(0);
    await expect(updateClient(sales, client.id, star)).rejects.toBeInstanceOf(ConflictError);
    await setClientArchived(sales, client.id, false);
    expect(await listClients(sales)).toHaveLength(1);
  });
});

describe("contacts", () => {
  it("makes the first contact primary and keeps one primary per client", async () => {
    const sales = await makeActor("sales");
    const client = await createClient(sales, star);
    const first = await createContact(sales, client.id, {
      name: "Asha Rao",
      email: "ASHA@x.example",
    });
    expect(first).toMatchObject({ isPrimary: true, email: "asha@x.example" });
    const second = await createContact(sales, client.id, { name: "Ravi K" });
    expect(second.isPrimary).toBe(false);

    await setPrimaryContact(sales, second.id);
    const contacts = await db.contact.findMany({ where: { clientId: client.id, isPrimary: true } });
    expect(contacts.map((c) => c.id)).toEqual([second.id]);

    await setContactArchived(sales, second.id, true);
    expect(await db.contact.findUnique({ where: { id: second.id } })).toMatchObject({
      status: "ARCHIVED",
      isPrimary: false,
    });
  });

  it("has a database guard against two primary contacts", async () => {
    const sales = await makeActor("sales");
    const client = await createClient(sales, star);
    await createContact(sales, client.id, { name: "Asha Rao" });
    await expect(
      db.contact.create({ data: { clientId: client.id, name: "Second", isPrimary: true } }),
    ).rejects.toThrow();
  });

  it("can't be added to an archived client", async () => {
    const sales = await makeActor("sales");
    const client = await createClient(sales, star);
    await setClientArchived(sales, client.id, true);
    await expect(createContact(sales, client.id, { name: "Late" })).rejects.toBeInstanceOf(
      ConflictError,
    );
  });
});

describe("merging clients", () => {
  it("moves contacts, fills gaps, archives the duplicate and audits both sides", async () => {
    const sales = await makeActor("sales");
    const keep = await createClient(sales, {
      name: "Star Sports",
      countryCode: "IN",
      currency: "INR",
    });
    await createContact(sales, keep.id, { name: "Keeper" });
    const duplicate = await createClient(sales, { ...star, allowDuplicate: true });
    const moved = await createContact(sales, duplicate.id, { name: "Asha Rao" });

    await mergeClient(sales, duplicate.id, { targetId: keep.id, reason: "Entered twice" });

    const survivor = await getClient(sales, keep.id);
    expect(survivor.contacts.map((c) => [c.name, c.isPrimary])).toEqual([
      ["Keeper", true],
      ["Asha Rao", false],
    ]);
    expect(survivor).toMatchObject({ taxId: "27AAAAA0000A1Z5", website: star.website });
    expect(await getClient(sales, duplicate.id)).toMatchObject({
      status: "ARCHIVED",
      mergedIntoId: keep.id,
    });
    expect(moved.clientId).toBe(duplicate.id);
    const events = await db.auditEvent.findMany({
      where: { action: { in: ["client.merged", "client.merge_received"] } },
    });
    expect(events).toHaveLength(2);
    expect(events.find((e) => e.action === "client.merged")?.metadata).toMatchObject({
      reason: "Entered twice",
      moved: { contact: 1 },
    });
    await expect(setClientArchived(sales, duplicate.id, false)).rejects.toBeInstanceOf(
      ConflictError,
    );
  });

  it("needs a reason, a different target and both edit and archive rights", async () => {
    const sales = await makeActor("sales");
    const a = await createClient(sales, { name: "A Co", countryCode: "IN", currency: "INR" });
    const b = await createClient(sales, { name: "B Co", countryCode: "IN", currency: "INR" });
    await expect(mergeClient(sales, a.id, { targetId: b.id, reason: "" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(mergeClient(sales, a.id, { targetId: a.id, reason: "x" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      mergeClient(await makeActor("viewer"), a.id, { targetId: b.id, reason: "x" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
