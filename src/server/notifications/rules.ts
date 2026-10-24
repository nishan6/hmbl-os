import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { notify, usersWithPermission, type NotifyInput } from "./notify";

/*
 * Event notifications (docs/notifications.md): which audited changes notify
 * whom. They run inside recordAudit, in the same transaction as the change,
 * so they exist only if the change commits. Each audit event notifies each
 * person at most once (the dedupe key is the event's id).
 */

type Tx = Prisma.TransactionClient;

export type AuditedEvent = {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  legalEntityId: string | null;
  actorId: string | null;
  metadata: Record<string, unknown>;
};

type Rule = (
  tx: Tx,
  event: AuditedEvent & { targetId: string },
) => Promise<Omit<NotifyInput, "dedupeKey" | "excludeUserId" | "legalEntityId"> | null>;

const projectManagers = async (tx: Tx, projectIds: (string | null)[]) => {
  const ids = projectIds.filter((id): id is string => !!id);
  if (!ids.length) return [];
  const projects = await tx.project.findMany({
    where: { id: { in: ids } },
    select: { projectManagerId: true },
  });
  return projects.map((p) => p.projectManagerId);
};

async function quoteSubmitter(tx: Tx, quoteId: string) {
  const step = await tx.quoteApprovalStep.findFirst({
    where: { version: { quoteId }, action: "SUBMITTED" },
    orderBy: { at: "desc" },
    select: { actorId: true },
  });
  return step?.actorId ?? null;
}

const decided = (approved: boolean) => (approved ? "approved" : "sent back");

const quoteDecision =
  (approved: boolean): Rule =>
  async (tx, e) => {
    const q = await tx.quote.findUniqueOrThrow({
      where: { id: e.targetId },
      select: { number: true, title: true, ownerId: true },
    });
    return {
      userIds: [await quoteSubmitter(tx, e.targetId), q.ownerId],
      kind: "approval.decided",
      title: `Quotation ${q.number} was ${decided(approved)}`,
      body: q.title,
      href: `/quotes/${e.targetId}`,
    };
  };

const orderDecision =
  (approved: boolean): Rule =>
  async (tx, e) => {
    if (e.metadata.auto) return null;
    const o = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id: e.targetId },
      select: { number: true, submittedById: true, vendor: { select: { name: true } } },
    });
    return {
      userIds: [o.submittedById],
      kind: "approval.decided",
      title: `Purchase order ${o.number ?? "draft"} was ${decided(approved)}`,
      body: o.vendor.name,
      href: `/procurement/${e.targetId}`,
    };
  };

const billDecision =
  (approved: boolean): Rule =>
  async (tx, e) => {
    const b = await tx.vendorBill.findUniqueOrThrow({
      where: { id: e.targetId },
      select: {
        vendorInvoiceNumber: true,
        submittedById: true,
        vendor: { select: { name: true } },
      },
    });
    return {
      userIds: [b.submittedById],
      kind: "approval.decided",
      title: `The bill from ${b.vendor.name} was ${decided(approved)}`,
      body: b.vendorInvoiceNumber,
      href: `/finance/bills/${e.targetId}`,
    };
  };

const claimDecision =
  (approved: boolean): Rule =>
  async (tx, e) => {
    const c = await tx.expenseClaim.findUniqueOrThrow({
      where: { id: e.targetId },
      select: { title: true, claimantId: true },
    });
    return {
      userIds: [c.claimantId],
      kind: "approval.decided",
      title: `Your expense claim was ${decided(approved)}`,
      body: c.title,
      href: `/expenses/${e.targetId}`,
    };
  };

const tripDecision =
  (approved: boolean): Rule =>
  async (tx, e) => {
    const t = await tx.travelRequest.findUniqueOrThrow({
      where: { id: e.targetId },
      select: { title: true, createdById: true },
    });
    return {
      userIds: [t.createdById],
      kind: "approval.decided",
      title: `The trip "${t.title}" was ${decided(approved)}`,
      href: `/logistics/travel/${e.targetId}`,
    };
  };

const bookingChanged: Rule = async (tx, e) => {
  const t = await tx.travelRequest.findUniqueOrThrow({
    where: { id: e.targetId },
    select: { title: true, createdById: true, projectId: true },
  });
  const cancelled = e.action === "travel_booking.cancelled";
  return {
    userIds: [t.createdById, ...(await projectManagers(tx, [t.projectId]))],
    kind: "travel.booking_changed",
    title: `A booking on "${t.title}" was ${cancelled ? "cancelled" : "changed"}`,
    body: typeof e.metadata.reason === "string" ? e.metadata.reason : null,
    href: `/logistics/travel/${e.targetId}`,
  };
};

/** A client answered a quotation in the portal: its owner hears at once. */
const portalAnswer =
  (accepted: boolean): Rule =>
  async (tx, e) => {
    if (e.metadata.via !== "portal") return null;
    const q = await tx.quote.findUniqueOrThrow({
      where: { id: e.targetId },
      select: { number: true, title: true, ownerId: true, createdById: true },
    });
    return {
      userIds: [q.ownerId ?? q.createdById],
      kind: "portal.client_activity",
      title: `The client ${accepted ? "accepted" : "declined"} quotation ${q.number} in the portal`,
      body: accepted
        ? q.title
        : typeof e.metadata.reason === "string"
          ? e.metadata.reason
          : q.title,
      href: `/quotes/${e.targetId}`,
    };
  };

/** A vendor answered an order in the portal: whoever raised it hears. */
const vendorAnswer =
  (confirmed: boolean): Rule =>
  async (tx, e) => {
    const o = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id: e.targetId },
      select: {
        number: true,
        createdById: true,
        submittedById: true,
        vendor: { select: { name: true } },
      },
    });
    return {
      userIds: [o.submittedById ?? o.createdById],
      kind: "portal.supplier_activity",
      title: `${o.vendor.name} ${confirmed ? "confirmed" : "declined"} purchase order ${o.number}`,
      body: typeof e.metadata.note === "string" ? e.metadata.note : null,
      href: `/procurement/${e.targetId}`,
    };
  };

const fromPortal = async (tx: Tx, e: AuditedEvent) =>
  e.metadata.via === "portal" ||
  (!!e.actorId &&
    (await tx.user.findUnique({ where: { id: e.actorId }, select: { kind: true } }))?.kind ===
      "EXTERNAL");

const bookingFor = (tx: Tx, id: string) =>
  tx.crewAssignment.findUniqueOrThrow({
    where: { id },
    select: {
      role: true,
      createdById: true,
      crewMember: { select: { name: true } },
      project: { select: { number: true, projectManagerId: true } },
    },
  });

export const AUDIT_RULES: Record<string, Rule> = {
  "purchase_order.vendor_confirmed": vendorAnswer(true),
  "purchase_order.vendor_declined": vendorAnswer(false),
  "vendor_invoice.uploaded": async (tx, e) => {
    const o = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id: e.targetId },
      select: {
        number: true,
        createdById: true,
        legalEntityId: true,
        vendor: { select: { name: true } },
      },
    });
    return {
      userIds: [o.createdById, ...(await usersWithPermission(tx, "finance.edit", o.legalEntityId))],
      kind: "portal.supplier_activity",
      title: `${o.vendor.name} uploaded an invoice for ${o.number}`,
      body:
        typeof e.metadata.vendorInvoiceNumber === "string"
          ? `Invoice ${e.metadata.vendorInvoiceNumber}. Enter the bill from it.`
          : null,
      href: `/procurement/${e.targetId}`,
    };
  },
  "crew_assignment.freelancer_available": async (tx, e) => {
    const id = e.metadata.assignmentId;
    if (typeof id !== "string") return null;
    const a = await bookingFor(tx, id);
    return {
      userIds: [a.createdById, a.project.projectManagerId],
      kind: "portal.supplier_activity",
      title: `${a.crewMember.name} can do ${a.role} on ${a.project.number}`,
      body: "Confirm the booking when you're ready.",
      href: `/projects/${e.targetId}/resources/crew/${id}`,
    };
  },
  "crew_assignment.declined": async (tx, e) => {
    const id = e.metadata.assignmentId;
    if (typeof id !== "string" || !(await fromPortal(tx, e))) return null;
    const a = await bookingFor(tx, id);
    return {
      userIds: [a.createdById, a.project.projectManagerId],
      kind: "portal.supplier_activity",
      title: `${a.crewMember.name} declined ${a.role} on ${a.project.number}`,
      body: typeof e.metadata.reason === "string" ? e.metadata.reason : null,
      href: `/projects/${e.targetId}/resources/crew/${id}`,
    };
  },
  "crew_work.recorded": async (tx, e) => {
    const id = e.metadata.assignmentId;
    if (typeof id !== "string" || e.metadata.via !== "portal") return null;
    const a = await bookingFor(tx, id);
    return {
      userIds: [a.project.projectManagerId],
      kind: "portal.supplier_activity",
      title: `${a.crewMember.name} recorded a day worked on ${a.project.number}`,
      body: typeof e.metadata.date === "string" ? e.metadata.date : null,
      href: `/projects/${e.targetId}/resources/crew/${id}`,
    };
  },
  "portal_details.requested": async (tx, e) => {
    const vendor = e.targetType === "vendor";
    const name = vendor
      ? (await tx.vendor.findUniqueOrThrow({ where: { id: e.targetId } })).name
      : (await tx.crewMember.findUniqueOrThrow({ where: { id: e.targetId } })).name;
    return {
      userIds: await usersWithPermission(tx, vendor ? "procurement.edit" : "crew.edit", null),
      kind: "portal.supplier_activity",
      title: `${name} asked for their details to be changed`,
      href: vendor ? `/procurement/vendors/${e.targetId}` : `/crew/${e.targetId}`,
    };
  },

  "quote.accepted": portalAnswer(true),
  "quote.declined": portalAnswer(false),
  "portal_submission.created": async (tx, e) => {
    const p = await tx.project.findUniqueOrThrow({
      where: { id: e.targetId },
      select: { number: true, name: true },
    });
    return {
      userIds: await projectManagers(tx, [e.targetId]),
      kind: "portal.client_activity",
      title: `The client sent information about ${p.number} in the portal`,
      body: typeof e.metadata.subject === "string" ? e.metadata.subject : p.name,
      href: `/projects/${e.targetId}`,
    };
  },

  "portal_invitation.accepted": async (tx, e) => {
    const i = await tx.portalInvitation.findUniqueOrThrow({
      where: { id: e.targetId },
      select: {
        name: true,
        createdById: true,
        clientId: true,
        vendorId: true,
        crewMemberId: true,
      },
    });
    const href = i.clientId
      ? `/crm/clients/${i.clientId}`
      : i.vendorId
        ? `/procurement/vendors/${i.vendorId}`
        : `/crew/${i.crewMemberId}`;
    return {
      userIds: [i.createdById],
      kind: "portal.invitation_accepted",
      title: `${i.name} accepted your portal invitation`,
      body: typeof e.metadata.organisation === "string" ? e.metadata.organisation : null,
      href,
    };
  },

  "quote.submitted": async (tx, e) => {
    const q = await tx.quote.findUniqueOrThrow({
      where: { id: e.targetId },
      select: { number: true, title: true, legalEntityId: true },
    });
    return {
      userIds: await usersWithPermission(tx, "commercial.approve", q.legalEntityId),
      kind: "approval.requested",
      title: `Quotation ${q.number} is waiting for approval`,
      body: q.title,
      href: `/quotes/${e.targetId}`,
    };
  },
  "quote.approved": quoteDecision(true),
  "quote.rejected": quoteDecision(false),

  "purchase_order.submitted": async (tx, e) => {
    const o = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id: e.targetId },
      select: { number: true, legalEntityId: true, vendor: { select: { name: true } } },
    });
    return {
      userIds: await usersWithPermission(tx, "procurement.approve", o.legalEntityId),
      kind: "approval.requested",
      title: `A purchase order to ${o.vendor.name} is waiting for approval`,
      body: o.number,
      href: `/procurement/${e.targetId}`,
    };
  },
  "purchase_order.approved": orderDecision(true),
  "purchase_order.rejected": orderDecision(false),

  "vendor_bill.submitted": async (tx, e) => {
    const b = await tx.vendorBill.findUniqueOrThrow({
      where: { id: e.targetId },
      select: {
        legalEntityId: true,
        vendorInvoiceNumber: true,
        vendor: { select: { name: true } },
        lines: { select: { projectId: true } },
      },
    });
    // Finance approvers, and the managers of the projects it is for
    // (a manager may approve a bill only for their own projects).
    return {
      userIds: [
        ...(await usersWithPermission(tx, "finance.approve", b.legalEntityId)),
        ...(await projectManagers(
          tx,
          b.lines.map((l) => l.projectId),
        )),
      ],
      kind: "approval.requested",
      title: `The bill from ${b.vendor.name} is waiting for approval`,
      body: b.vendorInvoiceNumber,
      href: `/finance/bills/${e.targetId}`,
    };
  },
  "vendor_bill.approved": billDecision(true),
  "vendor_bill.rejected": billDecision(false),

  "expense_claim.submitted": async (tx, e) => {
    const c = await tx.expenseClaim.findUniqueOrThrow({
      where: { id: e.targetId },
      select: {
        legalEntityId: true,
        title: true,
        claimant: { select: { name: true } },
        lines: { select: { projectId: true } },
      },
    });
    return {
      userIds: [
        ...(await usersWithPermission(tx, "finance.approve", c.legalEntityId)),
        ...(await projectManagers(
          tx,
          c.lines.map((l) => l.projectId),
        )),
      ],
      kind: "approval.requested",
      title: `${c.claimant.name}'s expense claim is waiting for review`,
      body: c.title,
      href: `/expenses/${e.targetId}`,
    };
  },
  "expense_claim.approved": claimDecision(true),
  "expense_claim.rejected": claimDecision(false),

  "travel_request.submitted": async (tx, e) => {
    const t = await tx.travelRequest.findUniqueOrThrow({
      where: { id: e.targetId },
      select: { title: true, legalEntityId: true, projectId: true },
    });
    return {
      userIds: [
        ...(await projectManagers(tx, [t.projectId])),
        ...(await usersWithPermission(tx, "logistics.approve", t.legalEntityId)),
      ],
      kind: "approval.requested",
      title: `The trip "${t.title}" is waiting for approval`,
      href: `/logistics/travel/${e.targetId}`,
    };
  },
  "travel_request.approved": tripDecision(true),
  "travel_request.rejected": tripDecision(false),
  "travel_booking.changed": bookingChanged,
  "travel_booking.cancelled": bookingChanged,

  "crew_assignment.proposed": async (tx, e) => {
    const id = e.metadata.assignmentId;
    if (typeof id !== "string") return null;
    const a = await tx.crewAssignment.findUniqueOrThrow({
      where: { id },
      select: {
        role: true,
        crewMember: { select: { userId: true } },
        project: { select: { number: true, name: true } },
      },
    });
    return {
      userIds: [a.crewMember.userId],
      kind: "crew.assignment_proposed",
      title: `You were proposed as ${a.role} on ${a.project.number}`,
      body: a.project.name,
      href: `/projects/${e.targetId}/resources`,
    };
  },

  "production.incident_reported": async (tx, e) => {
    const severity = e.metadata.severity;
    if (severity !== "HIGH" && severity !== "CRITICAL") return null;
    const i = await tx.showIncident.findUniqueOrThrow({
      where: { id: e.targetId },
      select: { title: true, project: { select: { id: true, number: true, legalEntityId: true } } },
    });
    return {
      userIds: [
        ...(await projectManagers(tx, [i.project.id])),
        ...(await usersWithPermission(tx, "production.edit", i.project.legalEntityId)),
      ],
      kind: "production.incident",
      title: `${severity === "CRITICAL" ? "Critical" : "Serious"} incident on ${i.project.number}`,
      body: i.title,
      href: `/production/${i.project.id}/incidents`,
    };
  },

  "receipt.recorded": async (tx, e) => {
    const r = await tx.receipt.findUniqueOrThrow({
      where: { id: e.targetId },
      select: {
        number: true,
        allocations: { select: { invoice: { select: { projectId: true } } } },
        client: { select: { name: true } },
      },
    });
    // The managers of the projects it pays for.
    return {
      userIds: await projectManagers(
        tx,
        r.allocations.map((a) => a.invoice.projectId),
      ),
      kind: "payment.recorded",
      title: `${r.client.name} paid (${r.number})`,
      href: `/finance/receipts/${e.targetId}`,
    };
  },
};

/** Notifies whoever the audited change concerns. Called by recordAudit. */
export async function notifyForAudit(tx: Tx, event: AuditedEvent) {
  const rule = AUDIT_RULES[event.action];
  if (!rule || !event.targetId) return;
  const input = await rule(tx, { ...event, targetId: event.targetId });
  if (!input) return;
  await notify(tx, {
    ...input,
    legalEntityId: event.legalEntityId,
    targetType: event.targetType,
    targetId: event.targetId,
    dedupeKey: `audit:${event.id}`,
    excludeUserId: event.actorId,
  });
}
