import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  changeProjectStatus,
  createProject,
  getProject,
  listProjects,
  updateProjectDetails,
} from "@/server/projects/projects";
import {
  createProjectType,
  ensureProjectTypeDefaults,
  listProjectTypes,
  setProjectTypeArchived,
} from "@/server/projects/types";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { makeActor, makeScopedActor } from "../helpers/actors";
import { makeClient } from "../helpers/crm";
import { makeQuotingEntity } from "../helpers/commercial";
import { makeAcceptedProject } from "../helpers/projects";

async function auditActions(targetId: string) {
  const events = await db.auditEvent.findMany({
    where: { targetId },
    orderBy: { occurredAt: "asc" },
  });
  return events.map((e) => e.action);
}

describe("projects from accepted quotes", () => {
  it("start approved, with the quote's scope and a status history", async () => {
    const { project, sales } = await makeAcceptedProject();
    const p = await getProject(sales, project.id);
    expect(p.status).toBe("APPROVED");
    expect(p.scope).toBe("Stage, sound and crew for the awards.");
    expect(p.statusChanges).toMatchObject([
      { fromStatus: null, toStatus: "APPROVED", reason: "Created from an accepted quote" },
    ]);
  });
});

describe("creating a project directly", () => {
  it("creates a draft with a number, for a client or as internal work", async () => {
    await ensureProjectTypeDefaults(db);
    const entity = await makeQuotingEntity();
    const client = await makeClient();
    const pm = await makeActor("project_manager");
    const project = await createProject(pm, {
      legalEntityId: entity.id,
      clientId: client.id,
      currency: "INR",
      name: "Monthly content retainer",
      revenueModel: "RETAINER",
      projectManagerId: pm.id,
    });
    expect(project).toMatchObject({ status: "DRAFT", quoteId: null, contractValueMinor: 0n });
    expect(project.number).toMatch(/^P-\d{4}-0001$/);
    expect(await auditActions(project.id)).toEqual(["project.created"]);

    const internal = await createProject(pm, {
      legalEntityId: entity.id,
      currency: "INR",
      name: "Warehouse move",
      revenueModel: "INTERNAL",
    });
    expect(internal.clientId).toBeNull();
  });

  it("needs a client unless the work is internal", async () => {
    const entity = await makeQuotingEntity();
    const pm = await makeActor("project_manager");
    await expect(
      createProject(pm, {
        legalEntityId: entity.id,
        currency: "INR",
        name: "Gala",
        revenueModel: "ITEMISED",
      }),
    ).rejects.toMatchObject({ fieldErrors: { clientId: [expect.any(String)] } });
  });

  it("is limited to people who can create projects in that entity", async () => {
    const entity = await makeQuotingEntity();
    const other = await makeQuotingEntity();
    const sales = await makeActor("sales");
    const scopedPm = await makeScopedActor("project_manager", other.id);
    const input = {
      legalEntityId: entity.id,
      currency: "INR",
      name: "Internal",
      revenueModel: "INTERNAL" as const,
    };
    await expect(createProject(sales, input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createProject(scopedPm, input)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("editing project details", () => {
  it("sets the team, type and dates, and audits the changes", async () => {
    const { project } = await makeAcceptedProject();
    const pm = await makeActor("project_manager");
    const producer = await makeActor("viewer");
    const live = await db.projectType.findUniqueOrThrow({ where: { code: "LIVE" } });
    const after = await updateProjectDetails(pm, project.id, {
      name: "Award night 2099",
      projectTypeId: live.id,
      revenueModel: "FIXED_FEE",
      projectManagerId: pm.id,
      producerId: producer.id,
      eventStartDate: "2099-03-09",
      eventEndDate: "2099-03-12",
      venue: "Dome, Mumbai",
      locations: "Rehearsal studio, Andheri",
      scope: "Stage, sound and crew for the awards.",
    });
    expect(after).toMatchObject({
      name: "Award night 2099",
      projectManagerId: pm.id,
      producerId: producer.id,
      revenueModel: "FIXED_FEE",
    });
    const event = await db.auditEvent.findFirstOrThrow({
      where: { targetId: project.id, action: "project.updated" },
    });
    expect(Object.keys(event.changes as object).sort()).toEqual(
      [
        "eventStartDate",
        "locations",
        "name",
        "producerId",
        "projectManagerId",
        "projectTypeId",
        "revenueModel",
      ].sort(),
    );
  });

  it("refuses archived types, disabled people and dates out of order", async () => {
    const { project } = await makeAcceptedProject();
    const owner = await makeActor("owner");
    const type = await createProjectType(owner, {
      code: "AWARDS",
      name: "Awards show",
      defaultRevenueModel: "ITEMISED",
    });
    await setProjectTypeArchived(owner, type.id, true);
    const base = { name: "Award night", revenueModel: "ITEMISED" as const };
    await expect(
      updateProjectDetails(owner, project.id, { ...base, projectTypeId: type.id }),
    ).rejects.toMatchObject({ fieldErrors: { projectTypeId: [expect.any(String)] } });
    await expect(
      updateProjectDetails(owner, project.id, {
        ...base,
        eventStartDate: "2099-03-12",
        eventEndDate: "2099-03-10",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    const gone = await makeActor("viewer");
    await db.user.update({ where: { id: gone.id }, data: { status: "DISABLED" } });
    await expect(
      updateProjectDetails(owner, project.id, { ...base, projectManagerId: gone.id }),
    ).rejects.toMatchObject({ fieldErrors: { projectManagerId: [expect.any(String)] } });
  });

  it("is for people who can edit projects", async () => {
    const { project, sales } = await makeAcceptedProject();
    await expect(
      updateProjectDetails(sales, project.id, { name: "X", revenueModel: "ITEMISED" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("moving a project through its lifecycle", () => {
  it("runs a direct project from draft to approval and records every step", async () => {
    const entity = await makeQuotingEntity();
    const pm = await makeActor("project_manager");
    const owner = await makeActor("owner");
    const project = await createProject(pm, {
      legalEntityId: entity.id,
      currency: "INR",
      name: "Office fit-out",
      revenueModel: "INTERNAL",
    });
    await changeProjectStatus(pm, project.id, { to: "COMMERCIAL_REVIEW" });
    await expect(changeProjectStatus(pm, project.id, { to: "APPROVED" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await changeProjectStatus(owner, project.id, { to: "APPROVED", reason: "Budget agreed" });
    await changeProjectStatus(pm, project.id, { to: "PLANNING" });

    const p = await getProject(pm, project.id);
    expect(p.status).toBe("PLANNING");
    expect(p.statusChanges.map((c) => [c.fromStatus, c.toStatus])).toEqual([
      ["APPROVED", "PLANNING"],
      ["COMMERCIAL_REVIEW", "APPROVED"],
      ["DRAFT", "COMMERCIAL_REVIEW"],
      [null, "DRAFT"],
    ]);
    expect(await auditActions(project.id)).toEqual([
      "project.created",
      "project.status_changed",
      "project.status_changed",
      "project.status_changed",
    ]);
  });

  it("needs a reason to hold, and resumes where the project was", async () => {
    const { project } = await makeAcceptedProject();
    const pm = await makeActor("project_manager");
    await changeProjectStatus(pm, project.id, { to: "PLANNING" });
    await expect(changeProjectStatus(pm, project.id, { to: "ON_HOLD" })).rejects.toMatchObject({
      fieldErrors: { reason: [expect.any(String)] },
    });
    const held = await changeProjectStatus(pm, project.id, {
      to: "ON_HOLD",
      reason: "Client postponed",
    });
    expect(held).toMatchObject({ status: "ON_HOLD", resumeStatus: "PLANNING" });
    await expect(changeProjectStatus(pm, project.id, { to: "READY" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    const resumed = await changeProjectStatus(pm, project.id, { to: "PLANNING" });
    expect(resumed).toMatchObject({ status: "PLANNING", resumeStatus: null });
  });

  it("lets only the Director cancel an approved project, and locks it", async () => {
    const { project } = await makeAcceptedProject();
    const pm = await makeActor("project_manager");
    const owner = await makeActor("owner");
    await expect(
      changeProjectStatus(pm, project.id, { to: "CANCELLED", reason: "Lost the venue" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await changeProjectStatus(owner, project.id, { to: "CANCELLED", reason: "Lost the venue" });
    await expect(
      updateProjectDetails(owner, project.id, { name: "Changed", revenueModel: "ITEMISED" }),
    ).rejects.toBeInstanceOf(ConflictError);
    const reopened = await changeProjectStatus(owner, project.id, {
      to: "APPROVED",
      reason: "Venue found",
    });
    expect(reopened.status).toBe("APPROVED");
  });

  it("is scoped to the project's entity", async () => {
    const { project } = await makeAcceptedProject();
    const other = await makeQuotingEntity();
    const elsewhere = await makeScopedActor("project_manager", other.id);
    await expect(
      changeProjectStatus(elsewhere, project.id, { to: "PLANNING" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("listing projects", () => {
  it("shows open projects by status filter", async () => {
    const { project } = await makeAcceptedProject();
    const owner = await makeActor("owner");
    expect(await listProjects(owner, { status: "open" })).toHaveLength(1);
    await changeProjectStatus(owner, project.id, { to: "CANCELLED", reason: "Dropped" });
    expect(await listProjects(owner, { status: "open" })).toHaveLength(0);
    expect(await listProjects(owner, { status: "CANCELLED" })).toHaveLength(1);
    expect(await listProjects(owner)).toHaveLength(1);
  });
});

describe("project types", () => {
  it("has defaults, and only group-wide configurers change them", async () => {
    await ensureProjectTypeDefaults(db);
    expect(await ensureProjectTypeDefaults(db)).toEqual([]);
    const pm = await makeActor("project_manager");
    expect((await listProjectTypes(pm)).map((t) => t.code)).toContain("BROADCAST");
    await expect(
      createProjectType(pm, { code: "X", name: "X", defaultRevenueModel: "ITEMISED" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const owner = await makeActor("owner");
    await expect(
      createProjectType(owner, { code: "LIVE", name: "Again", defaultRevenueModel: "ITEMISED" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
