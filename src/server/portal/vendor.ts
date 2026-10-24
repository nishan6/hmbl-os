import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { recordAudit } from "@/server/audit/record";
import { billSettlements } from "@/server/finance/bills";
import { readSnapshot } from "@/server/procurement/orders";
import {
  cleanFileName,
  contentTypeFor,
  isBlocked,
  retainUntil,
} from "@/server/projects/document-rules";
import { discardFile, writeFile } from "@/server/storage/files";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { parseMoneyToMinor } from "@/lib/money";
import { parseInput } from "@/lib/parse";
import { optionalText, requiredText } from "@/lib/validation";
import { requiredDate } from "@/server/projects/schemas";
import { authorizePortal, portalCaller, type PortalActor } from "./session";

/*
 * What a vendor's portal accounts see and do (docs/vendor-portal.md). Every
 * read is filtered by the account's vendor. Orders are shown as HMBL last
 * approved them, from the stored revision, never a draft amendment, and
 * without internal notes, budget lines or project costs.
 */

const uuid = z.uuid();
const known = (id: string) => {
  if (!uuid.safeParse(id).success) throw new NotFoundError();
  return id;
};

function vendorOf(actor: PortalActor, permission: string) {
  authorizePortal(actor, "VENDOR", permission);
  return actor.vendorId!;
}

const invalid = (field: string, message: string) =>
  new ValidationError("Check the highlighted fields.", { [field]: [message] });

// ─── Orders ──────────────────────────────────────────────────────────────────

/** Only orders HMBL has approved at least once ever reach the vendor. */
const sent = { revision: { gt: 0 } } as const;

/** An order's state in the words a vendor reads. */
export function vendorOrderState(status: string) {
  if (status === "CLOSED") return "closed" as const;
  if (status === "CANCELLED") return "cancelled" as const;
  if (status === "AMENDING") return "amending" as const;
  return "open" as const;
}

export async function listVendorOrders(actor: PortalActor) {
  const vendorId = vendorOf(actor, "orders.view");
  const orders = await db.purchaseOrder.findMany({
    where: { vendorId, ...sent },
    orderBy: [{ approvedAt: "desc" }],
    select: {
      id: true,
      number: true,
      kind: true,
      status: true,
      revision: true,
      currency: true,
      requiredDate: true,
      legalEntity: { select: { legalName: true } },
      project: { select: { number: true, name: true } },
      revisions: {
        orderBy: { revision: "desc" },
        take: 1,
        select: { totalMinor: true },
      },
      vendorResponses: { orderBy: { revision: "desc" }, take: 1 },
    },
  });
  return orders.map(({ revisions, vendorResponses, ...o }) => ({
    ...o,
    totalMinor: revisions[0]?.totalMinor ?? 0n,
    state: vendorOrderState(o.status),
    answer: vendorResponses[0]?.revision === o.revision ? vendorResponses[0] : null,
  }));
}

/** One order as HMBL last approved it, and whether the vendor can still answer it. */
export async function getVendorOrder(actor: PortalActor, orderId: string) {
  const vendorId = vendorOf(actor, "orders.view");
  const order = await db.purchaseOrder.findFirst({
    where: { id: known(orderId), vendorId, ...sent },
    select: {
      id: true,
      number: true,
      kind: true,
      status: true,
      revision: true,
      currency: true,
      approvedAt: true,
      legalEntity: { select: { legalName: true, tradingName: true } },
      project: { select: { number: true, name: true } },
      revisions: { orderBy: { revision: "desc" }, take: 1 },
      vendorResponses: { orderBy: { revision: "desc" } },
      billUploads: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          vendorInvoiceNumber: true,
          invoiceDate: true,
          currency: true,
          totalMinor: true,
          createdAt: true,
        },
      },
    },
  });
  if (!order) throw new NotFoundError();
  const revision = order.revisions[0]!;
  const snapshot = readSnapshot(revision.snapshot);
  if (!snapshot) throw new NotFoundError();
  const location = snapshot.deliveryLocationId
    ? await db.location.findUnique({
        where: { id: snapshot.deliveryLocationId },
        select: { name: true },
      })
    : null;
  const answer = order.vendorResponses.find((r) => r.revision === order.revision) ?? null;
  const state = vendorOrderState(order.status);
  const { revisions: _r, vendorResponses, ...rest } = order;
  void _r;
  return {
    ...rest,
    state,
    answer,
    earlierAnswers: vendorResponses.filter((r) => r.revision !== order.revision),
    canAnswer: state === "open" && !answer,
    // Supplier facing parts of the approved version only: no internal notes or budget links.
    approved: {
      revision: revision.revision,
      requiredDate: snapshot.requiredDate,
      hireFrom: snapshot.hireFrom,
      hireTo: snapshot.hireTo,
      deliveryLocation: location?.name ?? null,
      deliveryNotes: snapshot.deliveryNotes,
      terms: snapshot.terms,
      subtotalMinor: BigInt(snapshot.subtotalMinor),
      taxMinor: BigInt(snapshot.taxMinor),
      totalMinor: BigInt(snapshot.totalMinor),
      lines: snapshot.lines.map((l) => ({
        id: l.id,
        description: l.description,
        quantity: l.quantity,
        unitPriceMinor: BigInt(l.unitPriceMinor),
        amountMinor: BigInt(l.amountMinor),
        taxRateBps: l.taxRateBps,
        totalMinor: BigInt(l.totalMinor),
      })),
    },
  };
}

const answerInput = z.discriminatedUnion("answer", [
  z.object({ answer: z.literal("CONFIRMED"), note: optionalText(1000) }),
  z.object({ answer: z.literal("DECLINED"), note: requiredText(1000) }),
]);
export type OrderAnswerInput = z.input<typeof answerInput>;

/** The vendor confirms or declines the order as last approved. Whoever raised it is told. */
export async function answerVendorOrder(
  actor: PortalActor,
  orderId: string,
  revision: number,
  raw: OrderAnswerInput,
) {
  authorizePortal(actor, "VENDOR", "orders.confirm");
  const input = parseInput(answerInput, raw);
  const order = await getVendorOrder(actor, orderId);
  if (!order.canAnswer) throw new ConflictError("This order can't be answered now.");
  if (order.revision !== revision) {
    throw new ConflictError("HMBL changed this order while you were reading it. Review it again.");
  }
  return db.$transaction(async (tx) => {
    const now = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id: order.id },
      select: { revision: true, status: true, legalEntityId: true },
    });
    if (now.revision !== revision || vendorOrderState(now.status) !== "open") {
      throw new ConflictError(
        "HMBL changed this order while you were reading it. Review it again.",
      );
    }
    try {
      const response = await tx.purchaseOrderVendorResponse.create({
        data: {
          purchaseOrderId: order.id,
          revision,
          accountId: actor.accountId,
          answer: input.answer,
          note: input.note ?? null,
        },
      });
      await recordAudit(tx, portalCaller(actor), {
        action:
          input.answer === "CONFIRMED"
            ? "purchase_order.vendor_confirmed"
            : "purchase_order.vendor_declined",
        targetType: "purchase_order",
        targetId: order.id,
        legalEntityId: now.legalEntityId,
        metadata: { revision, note: input.note ?? null, via: "portal", responseId: response.id },
      });
      return response;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "P2002") {
        throw new ConflictError("This order has already been answered.");
      }
      throw error;
    }
  });
}

// ─── Invoices ────────────────────────────────────────────────────────────────

const uploadInput = z.object({
  vendorInvoiceNumber: requiredText(60),
  invoiceDate: requiredDate,
  total: requiredText(30),
  note: optionalText(1000),
  fileName: z.string().max(255),
  contentType: z.string().nullish(),
});
export type BillUploadInput = z.input<typeof uploadInput>;

/**
 * The vendor uploads their invoice for an order. The file is kept on the
 * order's documents, and Finance is told so they can enter the bill.
 */
export async function uploadVendorInvoice(
  actor: PortalActor,
  orderId: string,
  raw: BillUploadInput,
  body: ReadableStream<Uint8Array> | null,
) {
  const vendorId = vendorOf(actor, "bills.submit");
  const order = await db.purchaseOrder.findFirst({
    where: { id: known(orderId), vendorId, ...sent, status: { not: "CANCELLED" } },
    select: { id: true, number: true, currency: true, legalEntityId: true, projectId: true },
  });
  if (!order) throw new NotFoundError();
  const input = parseInput(uploadInput, raw);
  const totalMinor = parseMoneyToMinor(input.total, order.currency);
  if (totalMinor === null || totalMinor <= 0n) throw invalid("total", "Enter the invoice total");
  const fileName = cleanFileName(input.fileName);
  if (!fileName) throw invalid("file", "Choose your invoice file");
  if (isBlocked(fileName)) throw invalid("file", "Upload a PDF or an image of the invoice.");
  if (!body) throw invalid("file", "Choose your invoice file");
  if (
    await db.portalBillSubmission.findUnique({
      where: {
        vendorId_vendorInvoiceNumber: { vendorId, vendorInvoiceNumber: input.vendorInvoiceNumber },
      },
    })
  ) {
    throw invalid("vendorInvoiceNumber", "You have already uploaded an invoice with this number.");
  }

  const id = randomUUID();
  const storageKey = `documents/${order.id}/${id}`;
  const { sizeBytes, sha256 } = await writeFile(storageKey, body);
  try {
    if (sizeBytes === 0n) throw invalid("file", "The file is empty");
    return await db.$transaction(async (tx) => {
      const now = new Date();
      const doc = await tx.recordDocument.create({
        data: {
          id,
          recordType: "PURCHASE_ORDER",
          recordId: order.id,
          legalEntityId: order.legalEntityId,
          projectId: order.projectId,
          category: "INVOICE",
          title: `Invoice ${input.vendorInvoiceNumber} from ${actor.organisation}`,
          fileName,
          contentType: contentTypeFor(fileName, input.contentType ?? null),
          sizeBytes,
          sha256,
          storageKey,
          retainUntil: retainUntil("INVOICE", now),
          uploadedById: actor.id,
          uploadedAt: now,
        },
      });
      const submission = await tx.portalBillSubmission.create({
        data: {
          accountId: actor.accountId,
          vendorId,
          purchaseOrderId: order.id,
          vendorInvoiceNumber: input.vendorInvoiceNumber,
          invoiceDate: input.invoiceDate!,
          currency: order.currency,
          totalMinor,
          note: input.note ?? null,
          documentId: doc.id,
        },
      });
      await recordAudit(tx, portalCaller(actor), {
        action: "vendor_invoice.uploaded",
        targetType: "purchase_order",
        targetId: order.id,
        legalEntityId: order.legalEntityId,
        metadata: {
          submissionId: submission.id,
          documentId: doc.id,
          vendorInvoiceNumber: input.vendorInvoiceNumber,
          totalMinor: totalMinor.toString(),
          currency: order.currency,
          sha256,
          via: "portal",
        },
      });
      return submission;
    });
  } catch (error) {
    await discardFile(storageKey);
    throw error;
  }
}

/** Where each bill HMBL entered for this vendor stands, and what was paid. */
export async function listVendorBills(actor: PortalActor) {
  const vendorId = vendorOf(actor, "payments.view");
  const bills = await db.vendorBill.findMany({
    // Drafts are Finance's working copies; only bills past entry are shown.
    where: { vendorId, status: { in: ["SUBMITTED", "APPROVED", "VOIDED"] } },
    orderBy: [{ billDate: "desc" }],
    select: {
      id: true,
      vendorInvoiceNumber: true,
      billDate: true,
      dueDate: true,
      status: true,
      currency: true,
      totalMinor: true,
      tdsMinor: true,
      payableMinor: true,
      legalEntity: { select: { legalName: true } },
    },
  });
  const paid = await billSettlements(
    db,
    bills.filter((b) => b.status === "APPROVED").map((b) => b.id),
  );
  return bills.map((b) => {
    const paidMinor = paid.get(b.id)?.paidMinor ?? 0n;
    return {
      ...b,
      paidMinor,
      state:
        b.status === "VOIDED"
          ? ("voided" as const)
          : b.status === "SUBMITTED"
            ? ("checking" as const)
            : paidMinor >= b.payableMinor
              ? ("paid" as const)
              : paidMinor > 0n
                ? ("partially_paid" as const)
                : ("approved" as const),
    };
  });
}

/** Invoices this vendor uploaded in the portal. */
export async function myInvoiceUploads(actor: PortalActor) {
  const vendorId = vendorOf(actor, "bills.submit");
  return db.portalBillSubmission.findMany({
    where: { vendorId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      vendorInvoiceNumber: true,
      invoiceDate: true,
      currency: true,
      totalMinor: true,
      createdAt: true,
      purchaseOrder: { select: { id: true, number: true } },
    },
  });
}
