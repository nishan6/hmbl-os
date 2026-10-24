import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { localToday } from "@/server/commercial/quotes";
import { confirmAssignment, proposeAssignment } from "@/server/crew/assignments";
import { createCrewMember } from "@/server/crew/members";
import { publishCallSheet } from "@/server/production/call-sheets";
import { createChecklist } from "@/server/production/checklists";
import { reportIncident } from "@/server/production/incidents";
import { addNote, postStatusUpdate } from "@/server/production/log";
import { buildShowPack, offlineShows } from "@/server/production/pack";
import { saveRunOfShowItem } from "@/server/production/run-of-show";
import { NotFoundError } from "@/lib/errors";
import { PACK_VERSION } from "@/lib/offline/pack";
import { makeActor, makeScopedActor } from "../helpers/actors";
import { makeAcceptedProject } from "../helpers/projects";

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Moves the show (its event dates and its show item on the schedule) to the given days. */
async function moveShow(projectId: string, from: Date, to: Date) {
  await db.project.update({
    where: { id: projectId },
    data: { eventStartDate: from, eventEndDate: to },
  });
  await db.projectScheduleItem.updateMany({
    where: { projectId, kind: "SHOW" },
    data: { startDate: from, endDate: to.getTime() === from.getTime() ? null : to },
  });
}

/** A show running today and tomorrow, with a crew call, a note and an incident. */
async function setup() {
  const { entity, project } = await makeAcceptedProject();
  const today = localToday(entity.timezone);
  const tomorrow = new Date(today.getTime() + DAY);
  await moveShow(project.id, today, tomorrow);
  const pm = await makeActor("project_manager");
  const crew = await makeActor("show_crew");
  const coordinator = await makeActor("crew_coordinator");
  await db.project.update({ where: { id: project.id }, data: { projectManagerId: pm.id } });

  const member = await createCrewMember(coordinator, {
    name: "Kiran Rigger",
    kind: "FREELANCER",
    phone: "+91 98200 00042",
    emergencyContactName: "Sunita Rigger",
    emergencyContactPhone: "+91 99999 11111",
  });
  const { assignment } = await proposeAssignment(pm, project.id, {
    crewMemberId: member.id,
    role: "Rigger",
    startDate: iso(today),
    endDate: iso(tomorrow),
    callTime: "07:00",
  });
  await confirmAssignment(pm, assignment.id);
  await publishCallSheet(pm, project.id, { day: iso(today), notes: "Load-in via gate 3" });
  await saveRunOfShowItem(pm, project.id, { day: iso(today), startTime: "19:30", title: "Doors" });
  await addNote(crew, project.id, { body: "Power is on the stage-left board" });
  await postStatusUpdate(crew, project.id, { status: "ON_TRACK", message: "Rig going up" });
  await createChecklist(pm, project.id, { title: "Load-in", day: iso(today), items: "Barriers" });
  await reportIncident(crew, project.id, {
    occurredAt: new Date(Date.now() - 60_000),
    category: "INJURY",
    severity: "LOW",
    title: "Latch cut on the dock",
    description: "Small cut",
    peopleInvolved: "Kiran",
  });
  return { entity, project, pm, crew, today, tomorrow };
}

describe("the offline show pack", () => {
  it("holds what the venue crew read, and none of the sensitive records", async () => {
    const s = await setup();
    const pack = await buildShowPack(s.crew, s.project.id);

    expect(pack).toMatchObject({
      version: PACK_VERSION,
      userId: s.crew.id,
      show: { id: s.project.id, venue: "Dome, Mumbai", timeZone: s.entity.timezone },
      can: { post: true },
    });
    expect(pack.days.map((d) => d.date)).toEqual([iso(s.today), iso(s.tomorrow)]);
    const [first, second] = pack.days;
    expect(first!.running.map((r) => r.title)).toEqual(["Doors"]);
    expect(first!.callSheet).toMatchObject({ revision: 1, notes: "Load-in via gate 3" });
    expect(first!.callSheet!.crew).toEqual([
      expect.objectContaining({
        name: "Kiran Rigger",
        phone: "+91 98200 00042",
        callTime: "07:00",
      }),
    ]);
    // Only published sheets go offline: tomorrow's was never published.
    expect(second!.callSheet).toBeNull();
    expect(pack.checklists.map((l) => [l.title, l.items[0]!.version])).toEqual([["Load-in", 1]]);
    expect(pack.notes.map((n) => n.body)).toEqual(["Power is on the stage-left board"]);
    expect(pack.status).toMatchObject({ status: "ON_TRACK", message: "Rig going up" });

    const json = JSON.stringify(pack);
    // No emergency contacts, incidents (even in the log) or money.
    expect(json).not.toContain("Sunita");
    expect(json).not.toContain("+91 99999 11111");
    expect(json).not.toContain("Latch cut");
    expect(pack.log.some((e) => e.text.startsWith("Reported an incident"))).toBe(false);
    const keys = new Set<string>();
    JSON.parse(json, (key, value) => {
      keys.add(key);
      return value;
    });
    expect(
      [...keys].filter((k) =>
        /rate|cost|amount|minor|budget|price|emergency|passport|reference|pnr/i.test(k),
      ),
    ).toEqual([]);
  });

  it("is offered only for open shows in the window, and to people who may see them", async () => {
    const s = await setup();
    const elsewhere = await makeScopedActor("show_crew", (await makeAcceptedProject()).entity.id);
    const sales = await makeActor("sales");

    expect((await offlineShows(s.crew)).find((r) => r.id === s.project.id)).toMatchObject({
      days: [iso(s.today), iso(s.tomorrow)],
    });
    expect(await offlineShows(sales)).toEqual([]);
    expect((await offlineShows(elsewhere)).map((r) => r.id)).not.toContain(s.project.id);
    await expect(buildShowPack(sales, s.project.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(buildShowPack(elsewhere, s.project.id)).rejects.toBeInstanceOf(NotFoundError);

    // A show more than two weeks out isn't offered until it comes nearer.
    const later = new Date(s.today.getTime() + 20 * DAY);
    await moveShow(s.project.id, later, later);
    expect((await offlineShows(s.pm)).map((r) => r.id)).not.toContain(s.project.id);
    await expect(buildShowPack(s.pm, s.project.id)).rejects.toBeInstanceOf(NotFoundError);

    // Nor is a show that was called off.
    await moveShow(s.project.id, s.today, s.today);
    await db.project.update({
      where: { id: s.project.id },
      data: {
        status: "CANCELLED",
        resumeStatus: s.project.status,
      },
    });
    await expect(buildShowPack(s.pm, s.project.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});
