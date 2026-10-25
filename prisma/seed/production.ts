import type { PrismaClient } from "@/generated/prisma/client";
import { loadGrants } from "@/server/permissions/grants";
import { publishCallSheet } from "@/server/production/call-sheets";
import { createChecklist, setItemDone } from "@/server/production/checklists";
import { addNote, postStatusUpdate } from "@/server/production/log";
import { saveRunOfShowItem } from "@/server/production/run-of-show";

/**
 * DEMO show day on the first demo project: a running order for its first
 * show day, notes for the venue, a published call sheet, two checklists
 * (one partly ticked) and a status update.
 */
export async function seedDemoProduction(db: PrismaClient, pmId: string) {
  const project = await db.project.findFirst({
    where: { isDemo: true, status: { not: "CANCELLED" }, eventStartDate: { not: null } },
    orderBy: { createdAt: "asc" },
  });
  if (!project?.eventStartDate) return 0;
  if (await db.runOfShowItem.count({ where: { projectId: project.id } })) return 0;
  const user = await db.user.findUniqueOrThrow({ where: { id: pmId } });
  const pm = { id: pmId, name: user.name, email: user.email, grants: await loadGrants(db, pmId) };
  const day = project.eventStartDate.toISOString().slice(0, 10);
  const running = [
    {
      startTime: "08:00",
      durationMinutes: "240",
      title: "Rigging and stage build",
      owner: "Production",
    },
    { startTime: "14:00", durationMinutes: "120", title: "Lighting focus", owner: "Lighting" },
    { startTime: "17:00", durationMinutes: "60", title: "Sound check", owner: "Audio" },
    { startTime: "19:00", title: "Doors", owner: "Front of house" },
    { startTime: "20:00", durationMinutes: "150", title: "Show", owner: "Stage manager" },
    { startTime: "23:30", title: "Curfew", owner: "Venue" },
  ];
  for (const item of running) {
    await saveRunOfShowItem(pm, project.id, { day, ...item, notes: "DEMO" });
  }
  await addNote(pm, project.id, {
    body: "DEMO: loading dock closes at 18:00; use gate 3 after that.",
    pinned: true,
  });
  await addNote(pm, project.id, { body: "DEMO: venue power is 3-phase 63 A, stage left." });
  const confirmed = await db.crewAssignment.count({
    where: {
      projectId: project.id,
      status: "CONFIRMED",
      startDate: { lte: project.eventStartDate },
      endDate: { gte: project.eventStartDate },
    },
  });
  if (confirmed) {
    await publishCallSheet(pm, project.id, { day, notes: "DEMO: parking at gate 3, lunch 13:00." });
  }
  const checklist = await createChecklist(pm, project.id, {
    title: "DEMO load-in safety",
    day,
    template: "LOAD_IN",
  });
  const items = await db.showChecklistItem.findMany({
    where: { checklistId: checklist.id },
    orderBy: { position: "asc" },
    take: 3,
  });
  for (const item of items) await setItemDone(pm, item.id, { done: true });
  await createChecklist(pm, project.id, { title: "DEMO pre-show", day, template: "PRE_SHOW" });
  await postStatusUpdate(pm, project.id, {
    status: "ON_TRACK",
    message: "DEMO: advance done, all suppliers confirmed",
  });
  return running.length;
}
