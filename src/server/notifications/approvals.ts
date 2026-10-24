import "server-only";
import type { Actor } from "@/server/permissions/authorize";
import { listPendingApprovals } from "@/server/commercial/workflow";
import { ordersAwaitingApproval } from "@/server/procurement/orders";
import { billsAwaitingApproval } from "@/server/finance/bills";
import { claimsAwaitingApproval } from "@/server/expenses/claims";
import { tripsAwaitingApproval } from "@/server/logistics/travel";

/*
 * The approvals inbox (docs/notifications.md): what is waiting for this
 * person's decision, read from the records' own state with each module's
 * own rule for who may approve. A notification is not an approval; this
 * list is the work, and acting on it happens on the record.
 */

export type ApprovalItem = {
  key: string;
  type: "Quotation" | "Purchase order" | "Vendor bill" | "Expense claim" | "Trip";
  title: string;
  detail: string;
  entity: string;
  amountMinor: bigint | null;
  currency: string;
  submittedAt: Date | null;
  href: string;
};

export async function approvalsFor(actor: Actor): Promise<ApprovalItem[]> {
  const [quotes, orders, bills, claims, trips] = await Promise.all([
    listPendingApprovals(actor),
    ordersAwaitingApproval(actor),
    billsAwaitingApproval(actor),
    claimsAwaitingApproval(actor),
    tripsAwaitingApproval(actor),
  ]);
  const items: ApprovalItem[] = [
    ...quotes.map((v) => ({
      key: `quote:${v.id}`,
      type: "Quotation" as const,
      title: `${v.quote.number} · ${v.quote.title}`,
      detail: v.quote.client.name,
      entity: "",
      amountMinor: v.totalMinor,
      currency: v.currency,
      submittedAt: v.submittedAt,
      href: `/quotes/${v.quoteId}`,
    })),
    ...orders.map((o) => ({
      key: `order:${o.id}`,
      type: "Purchase order" as const,
      title: o.number ? `${o.number}${o.revision ? ` amendment ${o.revision}` : ""}` : "New order",
      detail: o.vendor.name,
      entity: o.legalEntity.code,
      amountMinor: o.subtotalMinor,
      currency: o.currency,
      submittedAt: o.submittedAt,
      href: `/procurement/${o.id}`,
    })),
    ...bills.map((b) => ({
      key: `bill:${b.id}`,
      type: "Vendor bill" as const,
      title: `${b.vendor.name} ${b.vendorInvoiceNumber}`,
      detail: [...new Set(b.lines.map((l) => l.project?.number).filter(Boolean))].join(", "),
      entity: "",
      amountMinor: b.totalMinor,
      currency: b.currency,
      submittedAt: b.submittedAt,
      href: `/finance/bills/${b.id}`,
    })),
    ...claims.map((c) => ({
      key: `claim:${c.id}`,
      type: "Expense claim" as const,
      title: c.title,
      detail: c.claimant.name,
      entity: "",
      amountMinor: c.totalMinor,
      currency: c.currency,
      submittedAt: c.submittedAt,
      href: `/expenses/${c.id}`,
    })),
    ...trips.map((t) => ({
      key: `trip:${t.id}`,
      type: "Trip" as const,
      title: t.title,
      detail: t.project.number,
      entity: t.legalEntity.code,
      amountMinor: t.estimateMinor,
      currency: t.currency,
      submittedAt: t.submittedAt,
      href: `/logistics/travel/${t.id}`,
    })),
  ];
  return items.sort((a, b) => (a.submittedAt?.getTime() ?? 0) - (b.submittedAt?.getTime() ?? 0));
}
