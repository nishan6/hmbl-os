import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { applyTwoFactorPolicy } from "@/server/auth/two-factor-policy";
import { loadGrants } from "@/server/permissions/grants";
import { authorize, can, entityFilter, type Actor } from "@/server/permissions/authorize";
import { env } from "@/lib/env";
import { NotFoundError } from "@/lib/errors";
import { toIcs, type IcsEvent } from "@/lib/ics";

/*
 * The calendar feed (docs/integrations.md): a private link that any calendar
 * app can subscribe to, listing the show dates, phases and milestones of the
 * projects the person can see. Read-only, one way: HMBL OS is the source of
 * truth, and nothing comes back from the calendar.
 */

/** Days of past items kept in the feed, and how far ahead it reaches. */
export const FEED_PAST_DAYS = 60;
export const FEED_FUTURE_DAYS = 548;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

const KIND_LABEL = { SHOW: "Show", PHASE: "Phase", MILESTONE: "Milestone" } as const;

/** Whether the person has a link, and when a calendar last used it. */
export async function getCalendarFeed(actor: Actor) {
  return db.calendarFeed.findUnique({
    where: { userId: actor.id },
    select: { createdAt: true, lastUsedAt: true },
  });
}

/**
 * Makes a new link for the person, replacing any earlier one, which stops
 * working at once. Returns the secret, which is shown only now.
 */
export async function createCalendarFeed(actor: Actor) {
  authorize(actor, "projects.view");
  const token = randomBytes(32).toString("base64url");
  await db.$transaction(async (tx) => {
    const earlier = await tx.calendarFeed.findUnique({ where: { userId: actor.id } });
    const feed = earlier
      ? await tx.calendarFeed.update({
          where: { id: earlier.id },
          data: { tokenHash: hash(token), createdAt: new Date(), lastUsedAt: null },
        })
      : await tx.calendarFeed.create({ data: { userId: actor.id, tokenHash: hash(token) } });
    await recordAudit(tx, actor, {
      action: earlier ? "calendar_feed.replaced" : "calendar_feed.created",
      targetType: "calendar_feed",
      targetId: feed.id,
    });
  });
  return { token };
}

/** Turns the person's link off. */
export async function revokeCalendarFeed(actor: Actor) {
  await db.$transaction(async (tx) => {
    const feed = await tx.calendarFeed.findUnique({ where: { userId: actor.id } });
    if (!feed) throw new NotFoundError();
    await tx.calendarFeed.delete({ where: { id: feed.id } });
    await recordAudit(tx, actor, {
      action: "calendar_feed.revoked",
      targetType: "calendar_feed",
      targetId: feed.id,
    });
  });
}

/**
 * The feed for a link, or null when the link is unknown or its owner can no
 * longer sign in. Permissions are read again on every fetch, so a change of
 * role shows at the calendar's next refresh.
 */
export async function calendarFeedFor(token: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const feed = await db.calendarFeed.findUnique({
    where: { tokenHash: hash(token) },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          status: true,
          kind: true,
          twoFactorEnabled: true,
        },
      },
    },
  });
  if (!feed || feed.user.status !== "ACTIVE" || feed.user.kind !== "STAFF") return null;
  const { user } = feed;
  const actor: Actor = {
    id: user.id,
    name: user.name,
    email: user.email,
    grants: applyTwoFactorPolicy(await loadGrants(db, user.id), user.twoFactorEnabled).grants,
  };

  if (!feed.lastUsedAt || now.getTime() - feed.lastUsedAt.getTime() > 3_600_000) {
    await db.calendarFeed.update({ where: { id: feed.id }, data: { lastUsedAt: now } });
  }

  const day = 86_400_000;
  const items = can(actor, "projects.view")
    ? await db.projectScheduleItem.findMany({
        where: {
          project: { ...entityFilter(actor, "projects.view"), status: { not: "CANCELLED" } },
          OR: [
            { endDate: { gte: new Date(now.getTime() - FEED_PAST_DAYS * day) } },
            { endDate: null, startDate: { gte: new Date(now.getTime() - FEED_PAST_DAYS * day) } },
          ],
          startDate: { lte: new Date(now.getTime() + FEED_FUTURE_DAYS * day) },
        },
        include: { project: { select: { id: true, number: true, name: true } } },
        orderBy: [{ startDate: "asc" }, { id: "asc" }],
        take: 2000,
      })
    : [];

  const appUrl = env().APP_URL;
  const events: IcsEvent[] = items.map((i) => {
    const start = i.startDate.toISOString().slice(0, 10);
    const url = new URL(`/projects/${i.project.id}/schedule`, appUrl).toString();
    return {
      uid: `${i.id}@hmbl-os`,
      start,
      end: (i.endDate ?? i.startDate).toISOString().slice(0, 10),
      summary: `${i.kind === "MILESTONE" && i.completedAt ? "Done: " : ""}${i.title} · ${i.project.number} ${i.project.name}`,
      location: i.location,
      description: `${KIND_LABEL[i.kind]} for ${i.project.number} ${i.project.name}.\n${url}`,
      url,
      stamp: i.updatedAt,
    };
  });
  return toIcs({ name: "HMBL OS projects", events });
}
