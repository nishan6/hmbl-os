import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { confirmAssignment, proposeAssignment, updateAssignment } from "@/server/crew/assignments";
import { createCrewMember } from "@/server/crew/members";
import { callSheetDay, getCallSheet, publishCallSheet } from "@/server/production/call-sheets";
import {
  addNote,
  archiveNote,
  currentStatus,
  listNotes,
  postStatusUpdate,
  showLog,
  updateNote,
} from "@/server/production/log";
import { deleteRunOfShowItem, runOfShow, saveRunOfShowItem } from "@/server/production/run-of-show";
import { getShowDay, listShows } from "@/server/production/workspace";
import { saveScheduleItem } from "@/server/projects/schedule";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { makeActor, makeScopedActor } from "../helpers/actors";
import { day } from "../helpers/finance";
import { makeAcceptedProject } from "../helpers/projects";

/** The accepted project's show runs 10–12 March 2099 at the Dome, Mumbai. */
async function setup() {
  const { entity, project } = await makeAcceptedProject();
  const pm = await makeActor("project_manager");
  const crew = await makeActor("show_crew");
  const coordinator = await makeActor("crew_coordinator");
  await db.project.update({ where: { id: project.id }, data: { projectManagerId: pm.id } });
  const confirmed = async (
    name: string,
    role: string,
    callTime: string,
    phone = "+91 98200 00001",
  ) => {
    const member = await createCrewMember(coordinator, { name, kind: "EMPLOYEE", phone });
    const { assignment } = await proposeAssignment(pm, project.id, {
      crewMemberId: member.id,
      role,
      startDate: "2099-03-10",
      endDate: "2099-03-12",
      callTime,
    });
    await confirmAssignment(pm, assignment.id);
    return assignment;
  };
  return { entity, project, pm, crew, coordinator, confirmed };
}

describe("the show day", () => {
  it("is for people with production access in the project's entity", async () => {
    const s = await setup();
    const sales = await makeActor("sales");
    const otherEntity = await makeAcceptedProject();
    const elsewhere = await makeScopedActor("show_crew", otherEntity.entity.id);

    const view = await getShowDay(s.crew, s.project.id);
    expect(view.show.venue).toBe("Dome, Mumbai");
    expect(view.days.map((d) => d.toISOString().slice(0, 10))).toEqual([
      "2099-03-10",
      "2099-03-11",
      "2099-03-12",
    ]);
    // No show is "today" in 2099, so the first show day opens.
    expect(view.day).toEqual(day("2099-03-10"));
    expect(view.can).toMatchObject({ post: true, plan: false });

    await expect(getShowDay(sales, s.project.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getShowDay(elsewhere, s.project.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await listShows(s.crew)).map((r) => r.id)).toContain(s.project.id);
    expect(await listShows(sales)).toEqual([]);
    expect((await listShows(elsewhere)).map((r) => r.id)).not.toContain(s.project.id);
  });

  it("takes the show days from the schedule's shows and phases", async () => {
    const s = await setup();
    await saveScheduleItem(s.pm, s.project.id, {
      kind: "PHASE",
      title: "Build",
      startDate: "2099-03-08",
      endDate: "2099-03-09",
    });
    await saveScheduleItem(s.pm, s.project.id, {
      kind: "MILESTONE",
      title: "Rider signed off",
      startDate: "2099-02-01",
    });
    const view = await getShowDay(s.crew, s.project.id, day("2099-03-08"));
    expect(view.days[0]).toEqual(day("2099-03-08"));
    expect(view.days.map((d) => d.toISOString().slice(0, 10))).not.toContain("2099-02-01");
    expect(view.items.map((i) => i.title)).toEqual(["Build"]);
  });
});

describe("the run of show", () => {
  it("is kept by whoever plans the show, in venue time, with every change audited", async () => {
    const s = await setup();
    const doors = await saveRunOfShowItem(s.pm, s.project.id, {
      day: "2099-03-10",
      startTime: "7:30",
      durationMinutes: "30",
      title: "Doors",
      owner: "Front of house",
    });
    expect(doors.startTime).toBe("07:30");
    await saveRunOfShowItem(s.pm, s.project.id, {
      day: "2099-03-10",
      startTime: "0645",
      title: "Crew call",
    });
    expect((await runOfShow(s.crew, s.project.id, day("2099-03-10"))).map((r) => r.title)).toEqual([
      "Crew call",
      "Doors",
    ]);

    await saveRunOfShowItem(
      s.pm,
      s.project.id,
      { day: "2099-03-10", startTime: "19:00", title: "Doors" },
      doors.id,
    );
    await deleteRunOfShowItem(s.pm, doors.id);
    const events = await db.auditEvent.findMany({
      where: { targetType: "run_of_show_item", targetId: doors.id },
      orderBy: { occurredAt: "asc" },
    });
    expect(events.map((e) => e.action)).toEqual([
      "production.run_of_show_added",
      "production.run_of_show_changed",
      "production.run_of_show_removed",
    ]);
    expect(events[1]!.changes).toMatchObject({ startTime: { from: "07:30", to: "19:00" } });
    expect((await showLog(s.crew, s.project.id)).map((e) => e.text)).toContain(
      "Removed from the run of show: Doors",
    );
  });

  it("refuses bad times, far-off days, the venue crew and closed projects", async () => {
    const s = await setup();
    await expect(
      saveRunOfShowItem(s.pm, s.project.id, { day: "2099-03-10", startTime: "25:00", title: "X" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      saveRunOfShowItem(s.pm, s.project.id, { day: "2099-09-10", startTime: "10:00", title: "X" }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      saveRunOfShowItem(s.crew, s.project.id, {
        day: "2099-03-10",
        startTime: "10:00",
        title: "X",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // The database keeps the time well formed whatever the code does.
    await expect(
      db.runOfShowItem.create({
        data: {
          projectId: s.project.id,
          day: day("2099-03-10"),
          startTime: "7pm",
          title: "X",
          createdById: s.pm.id,
          updatedById: s.pm.id,
        },
      }),
    ).rejects.toThrow();
    await db.project.update({
      where: { id: s.project.id },
      data: { status: "CANCELLED", resumeStatus: s.project.status },
    });
    await expect(
      saveRunOfShowItem(s.pm, s.project.id, { day: "2099-03-10", startTime: "10:00", title: "X" }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("call sheets", () => {
  it("freezes the confirmed crew as revisions and says when bookings move on", async () => {
    const s = await setup();
    await expect(
      publishCallSheet(s.pm, s.project.id, { day: "2099-03-10" }),
    ).rejects.toBeInstanceOf(ConflictError);
    const sm = await s.confirmed("Meera Shah", "Stage manager", "06:00");
    await s.confirmed("Arjun Rao", "Lighting operator", "08:00");

    expect((await callSheetDay(s.crew, s.project.id, day("2099-03-10"))).changed).toBe(true);
    await expect(
      publishCallSheet(s.crew, s.project.id, { day: "2099-03-10" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const first = await publishCallSheet(s.pm, s.project.id, {
      day: "2099-03-10",
      notes: "Park at gate 3",
    });
    expect(first.revision).toBe(1);
    const view = await callSheetDay(s.crew, s.project.id, day("2099-03-10"));
    expect(view.changed).toBe(false);
    expect(view.published!.snapshot).toEqual({
      venue: "Dome, Mumbai",
      crew: [
        expect.objectContaining({ name: "Meera Shah", role: "Stage manager", callTime: "06:00" }),
        expect.objectContaining({
          name: "Arjun Rao",
          role: "Lighting operator",
          callTime: "08:00",
        }),
      ],
    });
    // Nothing to publish when nothing changed.
    await expect(
      publishCallSheet(s.pm, s.project.id, { day: "2099-03-10", notes: "Park at gate 3" }),
    ).rejects.toBeInstanceOf(ConflictError);

    await updateAssignment(s.pm, sm.id, {
      role: "Stage manager",
      startDate: "2099-03-10",
      endDate: "2099-03-12",
      callTime: "05:30",
    });
    expect((await callSheetDay(s.crew, s.project.id, day("2099-03-10"))).changed).toBe(true);
    // The crew still see what was published until a new revision goes out.
    expect(
      (await getShowDay(s.crew, s.project.id)).calls.published!.snapshot.crew[0],
    ).toMatchObject({
      callTime: "06:00",
    });
    const second = await publishCallSheet(s.pm, s.project.id, {
      day: "2099-03-10",
      notes: "Park at gate 3",
    });
    expect(second.revision).toBe(2);
    expect((await getCallSheet(s.crew, first.id)).current).toBe(false);
    expect((await getCallSheet(s.crew, second.id)).current).toBe(true);

    // Published sheets are never changed.
    await expect(
      db.callSheet.update({ where: { id: first.id }, data: { notes: "edited" } }),
    ).rejects.toThrow();
    const audit = await db.auditEvent.findMany({
      where: { action: "production.call_sheet_published", targetId: second.id },
    });
    expect(audit[0]!.metadata).toMatchObject({ revision: 2, day: "2099-03-10", crew: 2 });
  });
});

describe("notes and status updates", () => {
  it("lets the venue crew post, and only authors or planners change notes", async () => {
    const s = await setup();
    const other = await makeActor("show_crew");
    const note = await addNote(s.crew, s.project.id, {
      body: "Dock closes at 18:00",
      pinned: "on",
    });
    // Pinning is planning, so the crew's pin is ignored.
    expect(note.pinned).toBe(false);
    await expect(updateNote(other, note.id, { body: "Mine now" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await updateNote(s.crew, note.id, { body: "Dock closes at 18:30" });
    await updateNote(s.pm, note.id, { body: "Dock closes at 18:30", pinned: "on" });
    const planned = await addNote(s.pm, s.project.id, { body: "Client prefers blue wash" });
    expect((await listNotes(s.crew, s.project.id)).map((n) => [n.body, n.pinned])).toEqual([
      ["Dock closes at 18:30", true],
      ["Client prefers blue wash", false],
    ]);
    await archiveNote(s.pm, planned.id);
    expect((await listNotes(s.crew, s.project.id)).map((n) => n.id)).toEqual([note.id]);

    expect(await currentStatus(s.project.id)).toBeNull();
    await postStatusUpdate(s.crew, s.project.id, {
      status: "DELAYED",
      message: "Doors 15 min late",
    });
    await postStatusUpdate(s.crew, s.project.id, { status: "ON_TRACK", message: "Doors open" });
    expect(await currentStatus(s.project.id)).toMatchObject({
      status: "ON_TRACK",
      message: "Doors open",
    });
    await expect(
      postStatusUpdate(s.crew, s.project.id, { status: "NOPE" as "INFO", message: "x" }),
    ).rejects.toBeInstanceOf(ValidationError);

    const viewer = await makeActor("viewer");
    await expect(
      postStatusUpdate(viewer, s.project.id, { status: "INFO", message: "x" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const log = await showLog(viewer, s.project.id);
    expect(log.filter((e) => e.kind === "update").map((e) => e.text)).toEqual([
      "Doors open",
      "Doors 15 min late",
    ]);
    // Status updates are a record of what was said.
    const update = await db.showStatusUpdate.findFirstOrThrow({
      where: { projectId: s.project.id },
    });
    await expect(db.showStatusUpdate.delete({ where: { id: update.id } })).rejects.toThrow();
  });
});
