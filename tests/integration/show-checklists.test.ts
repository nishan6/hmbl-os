import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  archiveChecklist,
  createChecklist,
  listChecklists,
  saveChecklistItems,
  setItemDone,
} from "@/server/production/checklists";
import {
  listIncidents,
  reportIncident,
  resolveIncident,
  updateIncident,
} from "@/server/production/incidents";
import { showLog } from "@/server/production/log";
import { closeoutBlockers } from "@/server/projects/closeout-checks";
import { CHECKLIST_TEMPLATES } from "@/lib/production";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { makeActor } from "../helpers/actors";
import { makeAcceptedProject } from "../helpers/projects";

async function setup() {
  const { entity, project } = await makeAcceptedProject();
  const pm = await makeActor("project_manager");
  const crew = await makeActor("show_crew");
  await db.project.update({ where: { id: project.id }, data: { projectManagerId: pm.id } });
  return { entity, project, pm, crew };
}

describe("show checklists", () => {
  it("are made by planners from templates and ticked off by the venue crew", async () => {
    const s = await setup();
    await expect(
      createChecklist(s.crew, s.project.id, { title: "Mine", items: "One" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createChecklist(s.pm, s.project.id, { title: "Empty" })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const list = await createChecklist(s.pm, s.project.id, {
      title: "Load-in",
      day: "2099-03-10",
      template: "LOAD_IN",
      items: "- Barriers in place\n\n2. Smoke detectors isolated with venue sign-off",
    });
    const [view] = await listChecklists(s.crew, s.project.id);
    expect(view!.items.map((i) => i.label)).toEqual([
      ...CHECKLIST_TEMPLATES.LOAD_IN!.items,
      "Barriers in place",
      "Smoke detectors isolated with venue sign-off",
    ]);
    expect(view!.progress).toEqual({ done: 0, total: 10, complete: false });

    const item = view!.items[0]!;
    expect(await setItemDone(s.crew, item.id, { done: true, baseVersion: 1 })).toEqual({
      conflict: false,
      version: 2,
    });
    const [after] = await listChecklists(s.pm, s.project.id);
    expect(after!.items[0]).toMatchObject({ doneById: s.crew.id, doneBy: s.crew.name, version: 2 });
    expect(after!.progress.done).toBe(1);
    // Ticking what is already ticked changes nothing.
    expect(await setItemDone(s.pm, item.id, { done: true })).toEqual({
      conflict: false,
      version: 2,
    });
    expect((await showLog(s.pm, s.project.id)).map((e) => e.text)).toContain(
      `Ticked: ${item.label}`,
    );

    const viewer = await makeActor("viewer");
    await expect(setItemDone(viewer, item.id, { done: false })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await archiveChecklist(s.pm, list.id);
    expect(await listChecklists(s.pm, s.project.id)).toEqual([]);
    await expect(setItemDone(s.crew, item.id, { done: false })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("notices a change made from an out-of-date copy", async () => {
    const s = await setup();
    await createChecklist(s.pm, s.project.id, { title: "Pre-show", items: "Comms tested" });
    const item = (await listChecklists(s.pm, s.project.id))[0]!.items[0]!;
    await setItemDone(s.pm, item.id, { done: true, baseVersion: 1 });
    // The crew still see it unticked (version 1) and untick… nothing to undo, so they tick.
    const same = await setItemDone(s.crew, item.id, { done: true, baseVersion: 1 });
    expect(same).toEqual({ conflict: false, version: 2 });
    // …but unticking from version 1 would undo the planner's tick without seeing it.
    const clash = await setItemDone(s.crew, item.id, { done: false, baseVersion: 1 });
    expect(clash).toMatchObject({
      conflict: true,
      current: { version: 2, done: true, doneById: s.pm.id },
    });
    expect(
      (await db.showChecklistItem.findUniqueOrThrow({ where: { id: item.id } })).doneAt,
    ).not.toBeNull();
    // From the current version it goes through.
    expect(await setItemDone(s.crew, item.id, { done: false, baseVersion: 2 })).toEqual({
      conflict: false,
      version: 3,
    });
  });

  it("keeps ticks when items are relabelled, reordered or removed", async () => {
    const s = await setup();
    const list = await createChecklist(s.pm, s.project.id, { title: "Load-out", items: "A\nB\nC" });
    const [a, b, c] = (await listChecklists(s.pm, s.project.id))[0]!.items;
    await setItemDone(s.crew, b!.id, { done: true });
    await saveChecklistItems(s.pm, list.id, {
      items: [
        { id: b!.id, label: "B" },
        { id: a!.id, label: "A, counted" },
        { id: null, label: "D" },
      ],
    });
    const items = (await listChecklists(s.pm, s.project.id))[0]!.items;
    expect(items.map((i) => [i.label, Boolean(i.doneAt)])).toEqual([
      ["B", true],
      ["A, counted", false],
      ["D", false],
    ]);
    // A relabelled item moves on a version; a removed one is kept, out of the list.
    expect(items[1]!.version).toBe(a!.version + 1);
    expect(await db.showChecklistItem.findUniqueOrThrow({ where: { id: c!.id } })).toMatchObject({
      removedAt: expect.any(Date),
    });
    await expect(db.showChecklistItem.delete({ where: { id: c!.id } })).rejects.toThrow();
    await expect(
      saveChecklistItems(s.crew, list.id, { items: [{ id: null, label: "X" }] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      saveChecklistItems(s.pm, list.id, { items: [{ id: c!.id, label: "C" }] }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("incidents", () => {
  const incident = {
    occurredAt: new Date(Date.now() - 3_600_000),
    category: "INJURY" as const,
    severity: "HIGH" as const,
    title: "Hand cut on a case latch",
    description: "Loader cut his hand closing a flight case.",
    peopleInvolved: "Ravi (loader), first aider Meera",
    actionTaken: "First aid given; back at work",
  };

  it("are reported by the crew, with who was involved kept to planners and the reporter", async () => {
    const s = await setup();
    const other = await makeActor("show_crew");
    const reported = await reportIncident(s.crew, s.project.id, incident);
    expect(reported.status).toBe("OPEN");

    const [mine] = await listIncidents(s.crew, s.project.id);
    expect(mine).toMatchObject({
      peopleInvolved: incident.peopleInvolved,
      peopleHidden: false,
      mayEdit: true,
    });
    const [theirs] = await listIncidents(other, s.project.id);
    expect(theirs).toMatchObject({ peopleInvolved: null, peopleHidden: true, mayEdit: false });
    const [planner] = await listIncidents(s.pm, s.project.id);
    expect(planner!.peopleInvolved).toBe(incident.peopleInvolved);

    // The audit log records that names were given, not the names.
    const audit = await db.auditEvent.findFirstOrThrow({
      where: { action: "production.incident_reported", targetId: reported.id },
    });
    expect(JSON.stringify(audit.changes)).not.toContain("Ravi");

    // A serious incident tells the project manager at once.
    const told = await db.notification.findMany({
      where: { userId: s.pm.id, targetId: reported.id },
    });
    expect(told.map((n) => n.kind)).toEqual(["production.incident"]);

    await expect(updateIncident(other, reported.id, incident)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await updateIncident(s.crew, reported.id, { ...incident, severity: "MEDIUM" });
    await expect(
      reportIncident(s.crew, s.project.id, {
        ...incident,
        occurredAt: new Date(Date.now() + 86_400_000),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(db.showIncident.delete({ where: { id: reported.id } })).rejects.toThrow();
  });

  it("are resolved by planners, and open ones hold the final report at closeout", async () => {
    const s = await setup();
    const reported = await reportIncident(s.crew, s.project.id, { ...incident, severity: "LOW" });
    // Low severity tells nobody.
    expect(await db.notification.count({ where: { targetId: reported.id } })).toBe(0);
    expect((await closeoutBlockers(db, s.project.id)).FINAL_REPORT).toEqual([
      expect.objectContaining({ href: `/production/${s.project.id}/incidents` }),
    ]);
    await expect(
      resolveIncident(s.crew, reported.id, { resolution: "Sorted" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await resolveIncident(s.pm, reported.id, { resolution: "Latches replaced on all cases" });
    await expect(
      resolveIncident(s.pm, reported.id, { resolution: "Again" }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(updateIncident(s.crew, reported.id, incident)).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect((await closeoutBlockers(db, s.project.id)).FINAL_REPORT).toBeUndefined();
  });
});
