import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  calendarFeedFor,
  createCalendarFeed,
  getCalendarFeed,
  revokeCalendarFeed,
} from "@/server/integrations/calendar-feed";
import { listIntegrations } from "@/server/integrations/status";
import { saveScheduleItem } from "@/server/projects/schedule";
import { disableUser } from "@/server/users/service";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { makeActor, makeScopedActor } from "../helpers/actors";
import { makeAcceptedProject } from "../helpers/projects";

// The test projects are in 2099, so the feed is read as if it were then.
const NOW = new Date("2099-01-15T09:00:00Z");

const events = (ics: string) =>
  ics
    .split("BEGIN:VEVENT")
    .slice(1)
    .map((e) => e.replace(/\r\n /g, ""));

describe("the calendar feed", () => {
  it("lists the schedule of the projects its owner can see, without notes or money", async () => {
    const { project } = await makeAcceptedProject();
    const pm = await makeActor("project_manager");
    await saveScheduleItem(pm, project.id, {
      kind: "MILESTONE",
      title: "Design sign-off",
      startDate: "2099-02-01",
      notes: "Fee of 5,00,000 agreed with the client",
    });
    const { token } = await createCalendarFeed(pm);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const ics = await calendarFeedFor(token, NOW);
    expect(ics).toContain("BEGIN:VCALENDAR");
    const mine = events(ics!).filter((e) => e.includes(project.id));
    expect(mine).toHaveLength(2);
    const show = mine.find((e) => e.includes("SUMMARY:Show"))!;
    expect(show).toContain("DTSTART;VALUE=DATE:20990310");
    expect(show).toContain("DTEND;VALUE=DATE:20990313");
    expect(show).toContain("LOCATION:Dome\\, Mumbai");
    expect(ics).not.toContain("Fee of");

    // Someone who can't see projects in that entity gets an empty feed.
    const other = await makeAcceptedProject();
    const scoped = await makeScopedActor("project_manager", other.project.legalEntityId);
    const theirs = await calendarFeedFor((await createCalendarFeed(scoped)).token, NOW);
    expect(events(theirs!).some((e) => e.includes(project.id))).toBe(false);
    expect(events(theirs!).some((e) => e.includes(other.project.id))).toBe(true);

    expect((await getCalendarFeed(pm))?.lastUsedAt).toEqual(NOW);
  });

  it("stops working when replaced, turned off, or its owner is disabled, and audits each", async () => {
    const pm = await makeActor("project_manager");
    const first = await createCalendarFeed(pm);
    const second = await createCalendarFeed(pm);
    expect(await calendarFeedFor(first.token, NOW)).toBeNull();
    expect(await calendarFeedFor(second.token, NOW)).not.toBeNull();
    expect(await calendarFeedFor("not-a-token", NOW)).toBeNull();

    await revokeCalendarFeed(pm);
    expect(await calendarFeedFor(second.token, NOW)).toBeNull();
    await expect(revokeCalendarFeed(pm)).rejects.toThrow(NotFoundError);

    const third = await createCalendarFeed(pm);
    await disableUser(await makeActor("administrator").then(asTwoFactor), pm.id);
    expect(await calendarFeedFor(third.token, NOW)).toBeNull();

    const audit = await db.auditEvent.findMany({
      where: { actorId: pm.id, targetType: "calendar_feed" },
      select: { action: true },
    });
    expect(audit.map((a) => a.action).sort()).toEqual([
      "calendar_feed.created",
      "calendar_feed.created",
      "calendar_feed.replaced",
      "calendar_feed.revoked",
    ]);
  });

  it("needs projects.view to make a link, and follows the owner's current permissions", async () => {
    await expect(createCalendarFeed(await makeActor())).rejects.toThrow(ForbiddenError);

    const { project } = await makeAcceptedProject();
    const pm = await makeActor("project_manager");
    const { token } = await createCalendarFeed(pm);
    expect(await calendarFeedFor(token, NOW)).toContain(project.id);
    await db.userRole.deleteMany({ where: { userId: pm.id } });
    const after = await calendarFeedFor(token, NOW);
    expect(after).toContain("BEGIN:VCALENDAR");
    expect(events(after!)).toHaveLength(0);
  });
});

/** An administrator as if they had set up two-factor, which their role requires. */
async function asTwoFactor(actor: Awaited<ReturnType<typeof makeActor>>) {
  await db.user.update({ where: { id: actor.id }, data: { twoFactorEnabled: true } });
  return actor;
}

describe("the integrations page", () => {
  it("shows only built-in tools as working, and email as not set up", async () => {
    const list = await listIntegrations(await makeActor("sales"));
    const state = Object.fromEntries(list.map((i) => [i.key, i.state]));
    expect(state).toMatchObject({
      "csv-import": "working",
      "calendar-feed": "working",
      email: "not_set_up",
      "google-calendar": "not_built",
      gmail: "not_built",
      tally: "not_built",
      payments: "not_built",
    });
    for (const i of list.filter((i) => i.state !== "working")) {
      expect(i.detail).toMatch(/^Not (connected|built)|^No mail provider/);
    }
    await expect(listIntegrations(await makeActor())).rejects.toThrow(ForbiddenError);
  });
});
