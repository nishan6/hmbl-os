import "server-only";
import { db } from "@/server/db";
import { withUniqueConflict } from "@/server/db-errors";
import {
  authorize,
  authorizeEverywhere,
  entityFilter,
  type Actor,
} from "@/server/permissions/authorize";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { parseInput } from "@/lib/parse";
import {
  businessUnitInput,
  costCentreInput,
  departmentInput,
  legalEntityInput,
  locationInput,
  taxRegistrationInput,
  type BusinessUnitInput,
  type CostCentreInput,
  type DepartmentInput,
  type LegalEntityInput,
  type LocationInput,
  type TaxRegistrationInput,
} from "./schemas";

/*
 * Entity-owned records (legal entities, tax registrations, cost centres,
 * entity locations) are checked against the actor's grant for that entity.
 * Group-wide records (business units, departments, unassigned locations) need
 * an unscoped grant, because they affect every entity.
 */

type ListOptions = { includeArchived?: boolean };
const statusFilter = (o: ListOptions = {}) =>
  o.includeArchived ? {} : { status: "ACTIVE" as const };

// ─── Legal entities ──────────────────────────────────────────────────────────

export async function listLegalEntities(actor: Actor, options?: ListOptions) {
  authorize(actor, "organisation.view");
  return db.legalEntity.findMany({
    where: { ...statusFilter(options), ...entityFilter(actor, "organisation.view", "id") },
    orderBy: { code: "asc" },
  });
}

export async function getLegalEntity(actor: Actor, id: string) {
  const entity = await db.legalEntity.findUnique({
    where: { id },
    include: { taxRegistrations: { orderBy: { type: "asc" } } },
  });
  // Same answer for "missing" and "not yours", so ids can't be probed.
  if (!entity) throw new NotFoundError();
  try {
    authorize(actor, "organisation.view", { legalEntityId: id });
  } catch {
    throw new NotFoundError();
  }
  return entity;
}

export async function createLegalEntity(actor: Actor, input: LegalEntityInput) {
  authorizeEverywhere(actor, "organisation.create");
  const data = parseInput(legalEntityInput, input);
  return withUniqueConflict(`A legal entity with code ${data.code} already exists.`, () =>
    db.legalEntity.create({ data }),
  );
}

export async function updateLegalEntity(actor: Actor, id: string, input: LegalEntityInput) {
  await getLegalEntity(actor, id);
  authorize(actor, "organisation.edit", { legalEntityId: id });
  const data = parseInput(legalEntityInput, input);
  return withUniqueConflict(`A legal entity with code ${data.code} already exists.`, () =>
    db.legalEntity.update({ where: { id }, data }),
  );
}

export async function setLegalEntityArchived(actor: Actor, id: string, archived: boolean) {
  await getLegalEntity(actor, id);
  authorize(actor, "organisation.archive", { legalEntityId: id });
  return db.legalEntity.update({
    where: { id },
    data: { status: archived ? "ARCHIVED" : "ACTIVE" },
  });
}

export async function addTaxRegistration(
  actor: Actor,
  legalEntityId: string,
  input: TaxRegistrationInput,
) {
  await getLegalEntity(actor, legalEntityId);
  authorize(actor, "organisation.edit", { legalEntityId });
  const data = parseInput(taxRegistrationInput, input);
  if (data.validFrom && data.validTo && data.validTo < data.validFrom) {
    throw new ValidationError("Check the highlighted fields.", {
      validTo: ["Must be on or after the start date"],
    });
  }
  return withUniqueConflict(`${data.type} ${data.value} is already recorded.`, () =>
    db.taxRegistration.create({ data: { ...data, legalEntityId } }),
  );
}

// ─── Business units and departments (group-wide) ─────────────────────────────

export async function listBusinessUnits(actor: Actor, options?: ListOptions) {
  authorize(actor, "organisation.view");
  return db.businessUnit.findMany({ where: statusFilter(options), orderBy: { code: "asc" } });
}

export async function createBusinessUnit(actor: Actor, input: BusinessUnitInput) {
  authorizeEverywhere(actor, "organisation.create");
  const data = parseInput(businessUnitInput, input);
  return withUniqueConflict(`A business unit with code ${data.code} already exists.`, () =>
    db.businessUnit.create({ data }),
  );
}

export async function listDepartments(actor: Actor, options?: ListOptions) {
  authorize(actor, "organisation.view");
  return db.department.findMany({ where: statusFilter(options), orderBy: { code: "asc" } });
}

export async function createDepartment(actor: Actor, input: DepartmentInput) {
  authorizeEverywhere(actor, "organisation.create");
  const data = parseInput(departmentInput, input);
  if (data.parentId && !(await db.department.findUnique({ where: { id: data.parentId } }))) {
    throw new ValidationError("Check the highlighted fields.", {
      parentId: ["Unknown department"],
    });
  }
  return withUniqueConflict(`A department with code ${data.code} already exists.`, () =>
    db.department.create({ data }),
  );
}

// ─── Cost centres (entity-owned) ─────────────────────────────────────────────

export async function listCostCentres(actor: Actor, options?: ListOptions) {
  authorize(actor, "organisation.view");
  return db.costCentre.findMany({
    where: { ...statusFilter(options), ...entityFilter(actor, "organisation.view") },
    include: { legalEntity: { select: { code: true } } },
    orderBy: [{ legalEntity: { code: "asc" } }, { code: "asc" }],
  });
}

export async function createCostCentre(actor: Actor, input: CostCentreInput) {
  const data = parseInput(costCentreInput, input);
  await getLegalEntity(actor, data.legalEntityId);
  authorize(actor, "organisation.create", { legalEntityId: data.legalEntityId });
  return withUniqueConflict(`Cost centre ${data.code} already exists in this entity.`, () =>
    db.costCentre.create({ data }),
  );
}

// ─── Locations ───────────────────────────────────────────────────────────────

export async function listLocations(actor: Actor, options?: ListOptions) {
  authorize(actor, "organisation.view");
  const scoped = entityFilter(actor, "organisation.view");
  return db.location.findMany({
    where: {
      ...statusFilter(options),
      // Group-wide locations are visible to anyone who can view the organisation.
      ...("legalEntityId" in scoped ? { OR: [scoped, { legalEntityId: null }] } : {}),
    },
    orderBy: { code: "asc" },
  });
}

export async function createLocation(actor: Actor, input: LocationInput) {
  const data = parseInput(locationInput, input);
  if (data.legalEntityId) {
    await getLegalEntity(actor, data.legalEntityId);
    authorize(actor, "organisation.create", { legalEntityId: data.legalEntityId });
  } else {
    authorizeEverywhere(actor, "organisation.create");
  }
  return withUniqueConflict(`A location with code ${data.code} already exists.`, () =>
    db.location.create({ data }),
  );
}
