import "server-only";
import { db } from "@/server/db";
import { can, type Actor } from "@/server/permissions/authorize";

/*
 * What vendors and freelancers did in the portal, for the internal pages
 * (docs/vendor-portal.md). Each returns nothing for people who can't see
 * the record, so pages can always render it.
 */

export type PortalActivityItem = {
  id: string;
  title: string;
  by: string;
  at: Date;
  body: string | null;
};

const who = (a: { user: { name: string; email: string } }) => `${a.user.name} (${a.user.email})`;
const account = { select: { user: { select: { name: true, email: true } } } } as const;

/** The vendor's answers to an order and the invoices they uploaded for it. */
export async function orderPortalActivity(
  actor: Actor,
  orderId: string,
): Promise<PortalActivityItem[]> {
  const order = await db.purchaseOrder.findUnique({
    where: { id: orderId },
    select: {
      legalEntityId: true,
      vendorResponses: { include: { account } },
      billUploads: { include: { account } },
    },
  });
  if (!order || !can(actor, "procurement.view", { legalEntityId: order.legalEntityId })) return [];
  return [
    ...order.vendorResponses.map((r) => ({
      id: r.id,
      title: `${r.answer === "CONFIRMED" ? "Confirmed" : "Declined"} version ${r.revision}`,
      by: who(r.account),
      at: r.createdAt,
      body: r.note,
    })),
    ...order.billUploads.map((u) => ({
      id: u.id,
      title: `Uploaded invoice ${u.vendorInvoiceNumber}, see the documents below`,
      by: who(u.account),
      at: u.createdAt,
      body: u.note,
    })),
  ].sort((a, b) => +b.at - +a.at);
}

/** Changes a vendor or freelancer asked for in the portal. */
export async function detailsRequestsFor(
  actor: Actor,
  record: { vendorId: string } | { crewMemberId: string },
): Promise<PortalActivityItem[]> {
  const vendor = "vendorId" in record;
  if (!can(actor, vendor ? "procurement.view" : "crew.view")) return [];
  const rows = await db.portalDetailsRequest.findMany({
    where: record,
    orderBy: { createdAt: "desc" },
    include: { account },
  });
  return rows.map((r) => ({
    id: r.id,
    title: "Asked for their details to be changed",
    by: who(r.account),
    at: r.createdAt,
    body: r.details,
  }));
}

/** The freelancer's own answer to a booking. */
export async function bookingPortalAnswer(
  actor: Actor,
  assignmentId: string,
): Promise<PortalActivityItem[]> {
  if (!can(actor, "crew.view") && !can(actor, "projects.view")) return [];
  const r = await db.crewAssignmentResponse.findUnique({
    where: { assignmentId },
    include: { account },
  });
  return r
    ? [
        {
          id: r.id,
          title: r.answer === "CONFIRMED" ? "Said they can do it" : "Declined",
          by: who(r.account),
          at: r.createdAt,
          body: r.note,
        },
      ]
    : [];
}
