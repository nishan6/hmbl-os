import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createChecklist, listChecklists, setItemDone } from "@/server/production/checklists";
import { applyOfflineOperations } from "@/server/production/sync";
import { ValidationError } from "@/lib/errors";
import { makeActor, makeScopedActor } from "../helpers/actors";
import { makeAcceptedProject } from "../helpers/projects";

async function setup() {
  const { entity, project } = await makeAcceptedProject();
  const pm = await makeActor("project_manager");
  const crew = await makeActor("show_crew");
  await db.project.update({ where: { id: project.id }, data: { projectManagerId: pm.id } });
  await createChecklist(pm, project.id, { title: "Pre-show", items: "Comms tested\nExits clear" });
  const [list] = await listChecklists(pm, project.id);
  return { entity, project, pm, crew, items: list!.items };
}

const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

function tick(projectId: string, itemId: string, done: boolean, baseVersion = 1) {
  return {
    id: randomUUID(),
    kind: "checklist.tick",
    projectId,
    payload: { itemId, done },
    baseVersion,
    queuedAt: minutesAgo(10),
  };
}

function status(projectId: string, message: string) {
  return {
    id: randomUUID(),
    kind: "status.post",
    projectId,
    payload: { status: "DELAYED", message },
    queuedAt: minutesAgo(5),
  };
}

describe("changes made offline", () => {
  it("are applied through the usual checks, audited as offline, in order", async () => {
    const s = await setup();
    const ops = [
      tick(s.project.id, s.items[0]!.id, true),
      status(s.project.id, "Doors held 10 minutes"),
      {
        id: randomUUID(),
        kind: "note.add",
        projectId: s.project.id,
        payload: { body: "Generator B is the backup" },
        queuedAt: minutesAgo(4),
      },
      {
        id: randomUUID(),
        kind: "incident.report",
        projectId: s.project.id,
        payload: {
          occurredAt: minutesAgo(20),
          category: "SAFETY",
          severity: "MEDIUM",
          title: "Cable across the fire exit",
          description: "Moved and taped down",
          peopleInvolved: "Ravi",
        },
        queuedAt: minutesAgo(3),
      },
    ];
    const results = await applyOfflineOperations(s.crew, { operations: ops });
    expect(results.map((r) => r.status)).toEqual(["applied", "applied", "applied", "applied"]);
    expect(results[0]).toMatchObject({ id: ops[0]!.id, version: 2 });

    const item = await db.showChecklistItem.findUniqueOrThrow({ where: { id: s.items[0]!.id } });
    // Ticked when it was done at the venue, not when it reached the server.
    expect(item.doneAt?.toISOString()).toBe(ops[0]!.queuedAt);
    expect(item.doneById).toBe(s.crew.id);

    const audit = await db.auditEvent.findFirstOrThrow({
      where: { action: "production.status_posted", actorId: s.crew.id },
      orderBy: { occurredAt: "desc" },
    });
    expect(audit.metadata).toMatchObject({
      offline: true,
      operationId: ops[1]!.id,
      queuedAt: ops[1]!.queuedAt,
    });
    expect(await db.offlineOperation.count({ where: { userId: s.crew.id } })).toBe(4);
    // Who was involved stays out of what the server keeps about the change.
    const stored = await db.offlineOperation.findUniqueOrThrow({ where: { id: ops[3]!.id } });
    expect(JSON.stringify(stored)).not.toContain("Ravi");
  });

  it("are applied once however many times they are sent", async () => {
    const s = await setup();
    const op = status(s.project.id, "Rig in, sound check at 4");
    const first = await applyOfflineOperations(s.crew, { operations: [op] });
    const again = await applyOfflineOperations(s.crew, { operations: [op, op] });
    expect(first).toEqual([{ id: op.id, status: "applied" }]);
    expect(again).toEqual([
      { id: op.id, status: "applied", duplicate: true },
      { id: op.id, status: "applied", duplicate: true },
    ]);
    // Two sends at the same moment, e.g. from two tabs.
    const both = status(s.project.id, "Doors open");
    const racing = await Promise.all([
      applyOfflineOperations(s.crew, { operations: [both] }),
      applyOfflineOperations(s.crew, { operations: [both] }),
    ]);
    expect(racing.flat().map((r) => r.status)).toEqual(["applied", "applied"]);
    expect(
      await db.showStatusUpdate.count({
        where: {
          projectId: s.project.id,
          message: { in: [op.payload.message, both.payload.message] },
        },
      }),
    ).toBe(2);
    // The stored answer can't be changed afterwards.
    await expect(db.offlineOperation.delete({ where: { id: op.id } })).rejects.toThrow();
  });

  it("report a conflict when someone changed the item first, and change nothing", async () => {
    const s = await setup();
    const item = s.items[1]!;
    // Online, the planner ticks it; offline, the crew (from version 1) unticks it.
    await setItemDone(s.pm, item.id, { done: true, baseVersion: 1 });
    const [result] = await applyOfflineOperations(s.crew, {
      operations: [tick(s.project.id, item.id, false)],
    });
    expect(result).toMatchObject({
      status: "conflict",
      current: { version: 2, done: true, doneBy: s.pm.name },
    });
    const now = await db.showChecklistItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(now).toMatchObject({ version: 2, doneById: s.pm.id });
    // Ticking what they ticked is no conflict: both meant the same.
    const [same] = await applyOfflineOperations(s.crew, {
      operations: [tick(s.project.id, item.id, true)],
    });
    expect(same).toMatchObject({ status: "applied", version: 2 });
    // Choosing to keep their own change sends it again from the current version.
    const [mine] = await applyOfflineOperations(s.crew, {
      operations: [tick(s.project.id, item.id, false, 2)],
    });
    expect(mine).toMatchObject({ status: "applied", version: 3 });
  });

  it("are refused when access changed in the meantime, and the refusal is kept", async () => {
    const s = await setup();
    const viewOnly = await makeActor("crew_coordinator");
    const elsewhere = await makeScopedActor("show_crew", (await makeAcceptedProject()).entity.id);

    const op = status(s.project.id, "Delayed");
    const [refused] = await applyOfflineOperations(viewOnly, { operations: [op] });
    expect(refused).toMatchObject({
      status: "rejected",
      error: expect.stringMatching(/permission/),
    });
    expect(await applyOfflineOperations(viewOnly, { operations: [op] })).toEqual([
      { ...refused, duplicate: true },
    ]);
    const [hidden] = await applyOfflineOperations(elsewhere, {
      operations: [tick(s.project.id, s.items[0]!.id, true)],
    });
    expect(hidden).toMatchObject({ status: "rejected" });
    expect(await db.showStatusUpdate.count({ where: { projectId: s.project.id } })).toBe(0);

    // A closed show takes no more changes.
    await db.project.update({
      where: { id: s.project.id },
      data: { status: "CANCELLED", resumeStatus: s.project.status },
    });
    const [closed] = await applyOfflineOperations(s.crew, {
      operations: [tick(s.project.id, s.items[0]!.id, true)],
    });
    expect(closed).toMatchObject({ status: "rejected" });
  });

  it("refuse what doesn't add up, without saying anything about other people's changes", async () => {
    const s = await setup();
    const other = await makeAcceptedProject();
    const otherPm = await makeActor("project_manager");
    await createChecklist(otherPm, other.project.id, { title: "Elsewhere", items: "Thing" });
    const [otherList] = await listChecklists(otherPm, other.project.id);

    const op = status(s.project.id, "Mine");
    await applyOfflineOperations(s.crew, { operations: [op] });
    const someoneElse = await makeActor("show_crew");
    const results = await applyOfflineOperations(someoneElse, {
      operations: [
        op,
        { id: "not-a-uuid", kind: "status.post" },
        { ...status(s.project.id, ""), kind: "unknown.kind" },
        // An item from another show, sent as if it were this one's.
        tick(s.project.id, otherList!.items[0]!.id, true),
        { ...status(s.project.id, "   ") },
      ],
    });
    expect(results.map((r) => r.status)).toEqual([
      "rejected",
      "rejected",
      "rejected",
      "rejected",
      "rejected",
    ]);
    expect(results[0]).toEqual({
      id: op.id,
      status: "rejected",
      error: "This change couldn't be applied.",
    });
    expect(results[4]).toMatchObject({ fieldErrors: { message: expect.any(Array) } });
    await expect(applyOfflineOperations(s.crew, { operations: [] })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});
