import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  addTaxRegistration,
  createBusinessUnit,
  createCostCentre,
  createLegalEntity,
  createLocation,
  getLegalEntity,
  listCostCentres,
  listLegalEntities,
  listLocations,
  setLegalEntityArchived,
  updateLegalEntity,
} from "@/server/organisation/service";
import { loadGrants } from "@/server/permissions/grants";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { makeActor, makeScopedActor } from "../helpers/actors";
import { makeEntity } from "../helpers/organisation";

const entityInput = {
  code: "hmbl-in",
  legalName: "HMBL Productions Private Limited",
  countryCode: "in",
  baseCurrency: "inr",
  timezone: "Asia/Kolkata",
};

describe("legal entities", () => {
  it("creates an entity with normalised codes", async () => {
    const owner = await makeActor("owner");
    const entity = await createLegalEntity(owner, entityInput);
    expect(entity).toMatchObject({ code: "HMBL-IN", countryCode: "IN", baseCurrency: "INR" });
  });

  it("rejects unknown currencies and time zones", async () => {
    const owner = await makeActor("owner");
    await expect(
      createLegalEntity(owner, { ...entityInput, baseCurrency: "XYZ" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createLegalEntity(owner, { ...entityInput, timezone: "Mars/Olympus" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects duplicate codes with a conflict", async () => {
    const owner = await makeActor("owner");
    await createLegalEntity(owner, entityInput);
    await expect(createLegalEntity(owner, entityInput)).rejects.toBeInstanceOf(ConflictError);
  });

  it("has a database check on currency format", async () => {
    await expect(
      db.legalEntity.create({
        data: { ...entityInput, code: "RAW", countryCode: "IN", baseCurrency: "inr" },
      }),
    ).rejects.toThrow();
  });

  it("does not let a user scoped to one entity create new entities", async () => {
    const entity = await makeEntity();
    const scopedOwner = await makeScopedActor("owner", entity.id);
    await expect(createLegalEntity(scopedOwner, entityInput)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("only lists and opens the entities a scoped user can see", async () => {
    const india = await makeEntity({ code: "IN-1" });
    const uk = await makeEntity({ code: "UK-1" });
    const viewer = await makeScopedActor("viewer", india.id);

    expect((await listLegalEntities(viewer)).map((e) => e.code)).toEqual(["IN-1"]);
    await expect(getLegalEntity(viewer, india.id)).resolves.toMatchObject({ code: "IN-1" });
    await expect(getLegalEntity(viewer, uk.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lets a scoped administrator edit their entity but not another", async () => {
    const india = await makeEntity({ code: "IN-1" });
    const uk = await makeEntity({ code: "UK-1" });
    const admin = await makeScopedActor("administrator", india.id);
    const edit = { ...entityInput, code: "IN-1", legalName: "Renamed Pvt Ltd" };

    await expect(updateLegalEntity(admin, india.id, edit)).resolves.toMatchObject({
      legalName: "Renamed Pvt Ltd",
    });
    await expect(updateLegalEntity(admin, uk.id, { ...edit, code: "UK-1" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("hides archived entities by default and drops grants scoped to them", async () => {
    const owner = await makeActor("owner");
    const entity = await makeEntity();
    const scoped = await makeScopedActor("viewer", entity.id);
    await setLegalEntityArchived(owner, entity.id, true);

    expect(await listLegalEntities(owner)).toHaveLength(0);
    expect(await listLegalEntities(owner, { includeArchived: true })).toHaveLength(1);
    expect(await loadGrants(db, scoped.id)).toEqual([]);
  });

  it("records tax registrations and validates their dates", async () => {
    const owner = await makeActor("owner");
    const entity = await makeEntity();
    await addTaxRegistration(owner, entity.id, {
      type: "gstin",
      value: "27aaaaa0000a1z5",
      region: "MH",
    });
    await expect(
      addTaxRegistration(owner, entity.id, { type: "GSTIN", value: "27AAAAA0000A1Z5" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      addTaxRegistration(owner, entity.id, {
        type: "PAN",
        value: "AAAAA0000A",
        validFrom: "2026-04-01",
        validTo: "2025-04-01",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const loaded = await getLegalEntity(owner, entity.id);
    expect(loaded.taxRegistrations.map((t) => `${t.type}:${t.value}`)).toEqual([
      "GSTIN:27AAAAA0000A1Z5",
    ]);
  });
});

describe("group-wide records", () => {
  it("need an unscoped grant", async () => {
    const entity = await makeEntity();
    const scopedOwner = await makeScopedActor("owner", entity.id);
    const owner = await makeActor("owner");
    const input = { code: "LIVE", name: "Live production and touring" };

    await expect(createBusinessUnit(scopedOwner, input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createBusinessUnit(owner, input)).resolves.toMatchObject({ code: "LIVE" });
  });
});

describe("cost centres and locations", () => {
  it("belong to an entity the actor can reach", async () => {
    const india = await makeEntity({ code: "IN-1" });
    const uk = await makeEntity({ code: "UK-1" });
    const admin = await makeScopedActor("administrator", india.id);
    const owner = await makeActor("owner");

    await createCostCentre(admin, { legalEntityId: india.id, code: "OPS", name: "Operations" });
    await createCostCentre(owner, { legalEntityId: uk.id, code: "OPS", name: "Operations" });
    await expect(
      createCostCentre(admin, { legalEntityId: uk.id, code: "XX", name: "X" }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect((await listCostCentres(admin)).map((c) => c.legalEntity.code)).toEqual(["IN-1"]);
    expect(await listCostCentres(owner)).toHaveLength(2);
  });

  it("shows group-wide locations to scoped viewers", async () => {
    const india = await makeEntity({ code: "IN-1" });
    const uk = await makeEntity({ code: "UK-1" });
    const owner = await makeActor("owner");
    const base = { type: "WAREHOUSE" as const, countryCode: "IN", timezone: "Asia/Kolkata" };
    await createLocation(owner, {
      ...base,
      code: "WH-MUM",
      name: "Mumbai store",
      legalEntityId: india.id,
    });
    await createLocation(owner, {
      ...base,
      code: "WH-LON",
      name: "London store",
      legalEntityId: uk.id,
    });
    await createLocation(owner, { ...base, code: "VENUE-1", name: "Shared venue" });

    const viewer = await makeScopedActor("viewer", india.id);
    expect((await listLocations(viewer)).map((l) => l.code)).toEqual(["VENUE-1", "WH-MUM"]);
  });
});
