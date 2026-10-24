import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createQuote, saveDraft } from "@/server/commercial/quotes";
import { updateCommercialSettings } from "@/server/commercial/settings";
import { approveQuote, submitQuote } from "@/server/commercial/workflow";
import { recordAudit } from "@/server/audit/record";
import { createTrip, addTraveller, submitTrip, rejectTrip } from "@/server/logistics/travel";
import { approvalsFor } from "@/server/notifications/approvals";
import { deliverPending, MAX_ATTEMPTS } from "@/server/notifications/delivery";
import { notify } from "@/server/notifications/notify";
import {
  listNotifications,
  markAllRead,
  markRead,
  saveNotificationPreferences,
  unreadCount,
} from "@/server/notifications/service";
import { runSweep } from "@/server/notifications/sweep";
import { NotFoundError } from "@/lib/errors";
import { makeActor } from "../helpers/actors";
import { makeQuotingEntity, taxRate } from "../helpers/commercial";
import { makeClient } from "../helpers/crm";
import { giveBooks, issueSimpleInvoice, makeBillableClient } from "../helpers/finance";
import { makeAcceptedProject } from "../helpers/projects";

const mine = async (userId: string, targetId: string) =>
  db.notification.findMany({ where: { userId, targetId }, orderBy: { createdAt: "asc" } });

describe("event notifications", () => {
  it("tells the Director a quote is waiting and the salesperson what was decided", async () => {
    const entity = await makeQuotingEntity();
    const sales = await makeActor("sales");
    const director = await makeActor("owner");
    await updateCommercialSettings(director, entity.id, {
      requireQuoteApproval: true,
      quoteValidityDays: 30,
    });
    const quote = await createQuote(sales, {
      legalEntityId: entity.id,
      clientId: (await makeClient()).id,
      title: "Award night",
    });
    await saveDraft(sales, quote.id, {
      title: "Award night",
      currency: "INR",
      validUntil: "2099-12-31",
      taxRateId: (await taxRate("GST18")).id,
      lines: [
        {
          category: "SERVICES",
          description: "Show",
          method: "FIXED",
          unitCost: "60000",
          unitPrice: "100000",
        },
      ],
    });
    await submitQuote(sales, quote.id);
    const waiting = await mine(director.id, quote.id);
    expect(waiting).toHaveLength(1);
    expect(waiting[0]).toMatchObject({ kind: "approval.requested", href: `/quotes/${quote.id}` });
    // Whoever acted isn't told about their own action.
    expect(await mine(sales.id, quote.id)).toEqual([]);
    // The approvals inbox comes from the quote's state, not the notification.
    expect((await approvalsFor(director)).map((i) => i.href)).toContain(`/quotes/${quote.id}`);

    await approveQuote(director, quote.id);
    const told = await mine(sales.id, quote.id);
    expect(told.map((n) => n.kind)).toEqual(["approval.decided"]);
    expect(told[0]!.title).toMatch(/was approved/);
    expect((await approvalsFor(director)).map((i) => i.href)).not.toContain(`/quotes/${quote.id}`);
    // Delivered in the app at once, with the time recorded.
    const delivery = await db.notificationDelivery.findFirstOrThrow({
      where: { notificationId: told[0]!.id },
    });
    expect(delivery).toMatchObject({ channel: "IN_APP", status: "SENT" });
    expect(delivery.deliveredAt).not.toBeNull();
  });

  it("asks the project manager to approve a trip and tells the planner when sent back", async () => {
    const { project } = await makeAcceptedProject();
    const pm = await makeActor("project_manager");
    const planner = await makeActor("project_manager");
    await db.project.update({ where: { id: project.id }, data: { projectManagerId: pm.id } });
    const line = await db.projectBudgetLine.create({
      data: {
        projectId: project.id,
        position: 10,
        category: "TRAVEL",
        description: "Travel",
        quantity: 1,
        days: 1,
        costMinor: 0n,
        revenueMinor: 0n,
      },
    });
    const trip = await createTrip(planner, {
      projectId: project.id,
      title: "Recce",
      startDate: "2099-03-01",
      endDate: "2099-03-02",
      budgetLineId: line.id,
    });
    await addTraveller(planner, trip.id, { name: "Scout" });
    await submitTrip(planner, trip.id);
    expect((await mine(pm.id, trip.id)).map((n) => n.kind)).toEqual(["approval.requested"]);
    expect((await approvalsFor(pm)).map((i) => i.href)).toContain(`/logistics/travel/${trip.id}`);
    expect((await approvalsFor(planner)).map((i) => i.href)).not.toContain(
      `/logistics/travel/${trip.id}`,
    );
    await rejectTrip(pm, trip.id, { reason: "Too early" });
    expect((await mine(planner.id, trip.id)).map((n) => n.title)).toEqual([
      'The trip "Recce" was sent back',
    ]);
  });

  it("notifies nobody when the change rolls back", async () => {
    const owner = await makeActor("owner");
    const entity = await makeQuotingEntity();
    const quote = await createQuote(await makeActor("sales"), {
      legalEntityId: entity.id,
      clientId: (await makeClient()).id,
      title: "Rolled back",
    });
    const before = await db.notification.count();
    await expect(
      db.$transaction(async (tx) => {
        await recordAudit(tx, owner, {
          action: "quote.submitted",
          targetType: "quote",
          targetId: quote.id,
          legalEntityId: entity.id,
        });
        throw new Error("Something failed after");
      }),
    ).rejects.toThrow("Something failed after");
    expect(await db.notification.count()).toBe(before);
  });
});

describe("notifying", () => {
  it("never notifies the same person twice for the same thing, and honours preferences", async () => {
    const a = await makeActor("viewer");
    const b = await makeActor("viewer");
    await saveNotificationPreferences(b, {
      choices: [{ kind: "invoice.overdue", inApp: false, email: false }],
    });
    const input = {
      userIds: [a.id, b.id, a.id],
      kind: "invoice.overdue" as const,
      title: "Invoice overdue",
      dedupeKey: `test:${a.id}`,
    };
    expect(await db.$transaction((tx) => notify(tx, input))).toBe(1);
    expect(await db.$transaction((tx) => notify(tx, input))).toBe(0);
    expect(await unreadCount(a)).toBe(1);
    expect(await unreadCount(b)).toBe(0);

    // Only your own.
    const [n] = await listNotifications(a);
    await expect(markRead(b, n!.id)).rejects.toThrow(NotFoundError);
    await markRead(a, n!.id);
    expect(await unreadCount(a)).toBe(0);
    expect(await markAllRead(a)).toBe(0);
  });

  it("queues email, never claims it was sent without a transport, and retries failures", async () => {
    const a = await makeActor("viewer");
    await saveNotificationPreferences(a, {
      choices: [{ kind: "invoice.overdue", inApp: true, email: true }],
    });
    const send = (key: string) =>
      db.$transaction((tx) =>
        notify(tx, { userIds: [a.id], kind: "invoice.overdue", title: "Overdue", dedupeKey: key }),
      );
    const emailFor = async (key: string) =>
      db.notificationDelivery.findFirstOrThrow({
        where: { channel: "EMAIL", notification: { userId: a.id, dedupeKey: key } },
      });

    await send(`mail-none:${a.id}`);
    expect((await emailFor(`mail-none:${a.id}`)).status).toBe("PENDING");
    await deliverPending({ transport: null });
    const skipped = await emailFor(`mail-none:${a.id}`);
    expect(skipped).toMatchObject({ status: "NOT_CONFIGURED", deliveredAt: null });

    await send(`mail-ok:${a.id}`);
    const sent: string[] = [];
    await deliverPending({ transport: { send: async (m) => void sent.push(m.to) } });
    expect(sent).toContain(a.email);
    expect((await emailFor(`mail-ok:${a.id}`)).status).toBe("SENT");

    await send(`mail-bad:${a.id}`);
    let now = new Date();
    const failing = {
      send: async () => {
        throw new Error("Mailbox unavailable");
      },
    };
    for (let i = 1; i <= MAX_ATTEMPTS; i += 1) {
      await deliverPending({ transport: failing, now });
      const d = await emailFor(`mail-bad:${a.id}`);
      expect(d.attempts).toBe(i);
      expect(d.status).toBe(i < MAX_ATTEMPTS ? "RETRYING" : "FAILED");
      expect(d.lastError).toBe("Mailbox unavailable");
      // Not retried before its time.
      if (d.nextAttemptAt) now = new Date(d.nextAttemptAt.getTime());
    }
  });
});

describe("date checks", () => {
  it("flags an overdue invoice once, however often it runs", async () => {
    const entity = await makeQuotingEntity();
    await giveBooks(entity.id);
    const finance = await makeActor("finance");
    const invoice = await issueSimpleInvoice(finance, entity.id, (await makeBillableClient()).id, {
      invoiceDate: "2026-09-01",
      dueDate: "2026-09-15",
    });
    const now = new Date("2026-09-20T06:00:00Z");
    await runSweep(now);
    await runSweep(now);
    const flagged = await mine(finance.id, invoice.id);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({ kind: "invoice.overdue" });
    // Again at 30 days overdue.
    await runSweep(new Date("2026-10-16T06:00:00Z"));
    expect(await mine(finance.id, invoice.id)).toHaveLength(2);
  });
});
