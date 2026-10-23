import "server-only";
import { db } from "@/server/db";
import { withUniqueConflict } from "@/server/db-errors";
import { recordAudit } from "@/server/audit/record";
import { addMissingDefaultSchemes } from "@/server/numbering/defaults";
import { diffChanges } from "@/server/audit/diff";
import {
  authorize,
  authorizeEverywhere,
  entityFilter,
  type Actor,
} from "@/server/permissions/authorize";
import type { Permission } from "@/server/permissions/catalog";
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

const ENTITY_FIELDS = [
  "code",
  "legalName",
  "tradingName",
  "countryCode",
  "baseCurrency",
  "timezone",
  "addressLine1",
  "addressLine2",
  "city",
  "region",
  "postalCode",
  "status",
] as const;

/** Before/after for a newly created record: every given field from null. */
function created<T extends Record<string, unknown>>(
  record: T,
  fields: readonly (keyof T & string)[],
) {
  return diffChanges<T>(null, record, fields);
}

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
    db.$transaction(async (tx) => {
      const entity = await tx.legalEntity.create({ data });
      await recordAudit(tx, actor, {
        action: "legal_entity.created",
        targetType: "legal_entity",
        targetId: entity.id,
        legalEntityId: entity.id,
        changes: created(entity, ENTITY_FIELDS),
      });
      // Every entity can number quotes, projects and invoices from day one.
      await addMissingDefaultSchemes(tx, actor, entity);
      return entity;
    }),
  );
}

export async function updateLegalEntity(actor: Actor, id: string, input: LegalEntityInput) {
  const before = await getLegalEntity(actor, id);
  authorize(actor, "organisation.edit", { legalEntityId: id });
  const data = parseInput(legalEntityInput, input);
  return withUniqueConflict(`A legal entity with code ${data.code} already exists.`, () =>
    db.$transaction(async (tx) => {
      const after = await tx.legalEntity.update({ where: { id }, data });
      const changes = diffChanges(before, after, ENTITY_FIELDS);
      if (changes) {
        await recordAudit(tx, actor, {
          action: "legal_entity.updated",
          targetType: "legal_entity",
          targetId: id,
          legalEntityId: id,
          changes,
        });
      }
      return after;
    }),
  );
}

export async function setLegalEntityArchived(
  actor: Actor,
  id: string,
  archived: boolean,
  reason?: string,
) {
  const before = await getLegalEntity(actor, id);
  authorize(actor, "organisation.archive", { legalEntityId: id });
  const status = archived ? "ARCHIVED" : "ACTIVE";
  if (before.status === status) return before;
  return db.$transaction(async (tx) => {
    const after = await tx.legalEntity.update({ where: { id }, data: { status } });
    await recordAudit(tx, actor, {
      action: archived ? "legal_entity.archived" : "legal_entity.restored",
      targetType: "legal_entity",
      targetId: id,
      legalEntityId: id,
      changes: diffChanges(before, after, ["status"]),
      metadata: reason ? { reason } : undefined,
    });
    return after;
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
    db.$transaction(async (tx) => {
      const registration = await tx.taxRegistration.create({ data: { ...data, legalEntityId } });
      await recordAudit(tx, actor, {
        action: "tax_registration.created",
        targetType: "legal_entity",
        targetId: legalEntityId,
        legalEntityId,
        changes: created(registration, ["type", "value", "region", "validFrom", "validTo"]),
      });
      return registration;
    }),
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
    db.$transaction(async (tx) => {
      const unit = await tx.businessUnit.create({ data });
      await recordAudit(tx, actor, {
        action: "business_unit.created",
        targetType: "business_unit",
        targetId: unit.id,
        changes: created(unit, ["code", "name", "description"]),
      });
      return unit;
    }),
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
    db.$transaction(async (tx) => {
      const department = await tx.department.create({ data });
      await recordAudit(tx, actor, {
        action: "department.created",
        targetType: "department",
        targetId: department.id,
        changes: created(department, ["code", "name", "parentId"]),
      });
      return department;
    }),
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
    db.$transaction(async (tx) => {
      const centre = await tx.costCentre.create({ data });
      await recordAudit(tx, actor, {
        action: "cost_centre.created",
        targetType: "cost_centre",
        targetId: centre.id,
        legalEntityId: centre.legalEntityId,
        changes: created(centre, ["code", "name", "businessUnitId", "departmentId"]),
      });
      return centre;
    }),
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
    db.$transaction(async (tx) => {
      const location = await tx.location.create({ data });
      await recordAudit(tx, actor, {
        action: "location.created",
        targetType: "location",
        targetId: location.id,
        legalEntityId: location.legalEntityId,
        changes: created(location, ["code", "name", "type", "countryCode", "timezone", "city"]),
      });
      return location;
    }),
  );
}

/**
 * Active legal entities where the actor holds `permission`, for choosing which
 * entity a new record belongs to. Names only.
 */
export async function listEntityOptions(actor: Actor, permission: Permission) {
  return db.legalEntity.findMany({
    where: { status: "ACTIVE", ...entityFilter(actor, permission, "id") },
    select: { id: true, code: true, legalName: true, baseCurrency: true, countryCode: true },
    orderBy: { code: "asc" },
  });
}
