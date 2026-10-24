import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createQuote, saveDraft } from "@/server/commercial/quotes";
import { issueQuote, reviseQuote } from "@/server/commercial/workflow";
import { uploadDocument } from "@/server/documents/documents";
import { acceptInvitation } from "@/server/portal/accept";
import { invitePortalUser, revokePortalAccount } from "@/server/portal/access";
import {
  getClientInvoice,
  getSharedProject,
  getSharedQuote,
  listClientInvoices,
  listSharedDocuments,
  listSharedProjects,
  listSharedQuotes,
  mySubmissions,
  openSharedDocument,
  respondToQuote,
  submitProjectInformation,
} from "@/server/portal/client";
import { portalActorFor, type PortalActor } from "@/server/portal/session";
import {
  portalResponseFor,
  projectPortalActivity,
  shareWithClient,
  sharingFor,
  stopSharing,
} from "@/server/portal/sharing";
import { createInvoice } from "@/server/finance/invoices";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { PORTAL_PERMISSIONS } from "@/server/portal/permissions";
import { makeActor } from "../helpers/actors";
import { makeClient } from "../helpers/crm";
import { makeQuotingEntity, taxRate } from "../helpers/commercial";
import { issueSimpleInvoice, makeBillableClient, makeBooks } from "../helpers/finance";
import { makeAcceptedProject } from "../helpers/projects";

const PASSWORD = "portal-password-1";
const ALL = Object.keys(PORTAL_PERMISSIONS.CLIENT);
let people = 0;

/** A signed-up portal user at this client, with these permissions. */
async function portalUser(clientId: string, permissions = ALL): Promise<PortalActor> {
  people += 1;
  const email = `person${people}@client${people}.test`;
  const contact = await db.contact.create({ data: { clientId, name: `Person ${people}`, email } });
  const { token } = await invitePortalUser(
    await makeActor("sales"),
    { kind: "CLIENT", id: clientId },
    { name: `Person ${people}`, email, contactId: contact.id, permissions },
  );
  await acceptInvitation(
    token,
    { email, name: `Person ${people}`, password: PASSWORD, confirm: PASSWORD },
    { ipAddress: "203.0.113.7", userAgent: "vitest" },
  );
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  return (await portalActorFor(user, { ipAddress: "203.0.113.7", userAgent: "vitest" }))!;
}

/** An issued quotation for a client, with a cost the client must never see. */
async function issuedQuote(over: { poRequired?: boolean } = {}) {
  const entity = await makeQuotingEntity();
  const client = await makeClient();
  const sales = await makeActor("sales");
  const quote = await createQuote(sales, {
    legalEntityId: entity.id,
    clientId: client.id,
    title: "Award night",
  });
  const term = await db.paymentTerm.findUniqueOrThrow({ where: { code: "ADV50" } });
  await saveDraft(sales, quote.id, {
    title: "Award night",
    currency: "INR",
    validUntil: "2099-12-31",
    taxRateId: (await taxRate("GST18")).id,
    paymentTermId: term.id,
    poRequired: over.poRequired ? "on" : "",
    eventStartDate: "2099-03-10",
    eventEndDate: "2099-03-12",
    venue: "Dome, Mumbai",
    internalNotes: "Margin is thin; push for the advance.",
    lines: [
      {
        category: "PRODUCTION",
        description: "Stage build",
        method: "FIXED",
        unitCost: "60000",
        unitPrice: "100000",
      },
    ],
  });
  await issueQuote(sales, quote.id);
  return { entity, client, sales, quote };
}

const body = (text: string) => new Blob([text]).stream();

describe("sharing with a client", () => {
  it("shows nothing until shared, and only the client's own records", async () => {
    const { client, project } = await makeAcceptedProject();
    const pm = await makeActor("project_manager");
    const asha = await portalUser(client.id);
    expect(await listSharedProjects(asha)).toEqual([]);
    await expect(getSharedProject(asha, project.id)).rejects.toThrow(NotFoundError);

    await shareWithClient(pm, { kind: "PROJECT", id: project.id });
    await shareWithClient(pm, { kind: "PROJECT", id: project.id }); // twice is once
    expect(await db.portalShare.count({ where: { projectId: project.id } })).toBe(1);
    expect((await listSharedProjects(asha)).map((p) => p.id)).toEqual([project.id]);

    // Another client's people never see it, even with its id.
    const other = await portalUser((await makeClient()).id);
    expect(await listSharedProjects(other)).toEqual([]);
    await expect(getSharedProject(other, project.id)).rejects.toThrow(NotFoundError);
    await expect(getSharedProject(other, "not-a-uuid")).rejects.toThrow(NotFoundError);

    const audit = await db.auditEvent.findFirstOrThrow({
      where: { action: "portal_share.created" },
    });
    expect(audit).toMatchObject({ actorId: pm.id, legalEntityId: project.legalEntityId });
  });

  it("gives the client project dates, status and milestones, never money or notes", async () => {
    const { client, project } = await makeAcceptedProject();
    const pm = await makeActor("project_manager");
    await shareWithClient(pm, { kind: "PROJECT", id: project.id });
    const shown = await getSharedProject(await portalUser(client.id), project.id);
    expect(Object.keys(shown).sort()).toEqual(
      [
        "currency",
        "eventEndDate",
        "eventStartDate",
        "id",
        "milestones",
        "name",
        "number",
        "status",
        "venue",
      ].sort(),
    );
    expect(Object.keys(shown.milestones[0]!).sort()).toEqual(
      ["amountMinor", "dueDate", "id", "label"].sort(),
    );
    const text = JSON.stringify(shown, (_, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(text).not.toMatch(/budget|cost|margin|notes/i);
  });

  it("needs the right to send the record, and stops when sharing stops", async () => {
    const { client, project } = await makeAcceptedProject();
    const pm = await makeActor("project_manager");
    const viewer = await makeActor("viewer");
    await expect(shareWithClient(viewer, { kind: "PROJECT", id: project.id })).rejects.toThrow(
      ForbiddenError,
    );
    expect(await sharingFor(viewer, { kind: "PROJECT", id: project.id })).toMatchObject({
      canShare: false,
      share: null,
    });
    const asha = await portalUser(client.id);
    await shareWithClient(pm, { kind: "PROJECT", id: project.id });
    expect((await sharingFor(pm, { kind: "PROJECT", id: project.id })).accounts).toBe(1);
    await stopSharing(pm, { kind: "PROJECT", id: project.id });
    expect(await listSharedProjects(asha)).toEqual([]);
    // A stopped share is history: it can't be revived or deleted.
    const share = await db.portalShare.findFirstOrThrow({ where: { projectId: project.id } });
    await expect(
      db.portalShare.update({ where: { id: share.id }, data: { revokedAt: null } }),
    ).rejects.toThrow(/only be revoked/);
    await expect(db.portalShare.delete({ where: { id: share.id } })).rejects.toThrow();
    // Sharing again makes a new share.
    await shareWithClient(pm, { kind: "PROJECT", id: project.id });
    expect(await db.portalShare.count({ where: { projectId: project.id } })).toBe(2);
  });

  it("can't point a share at another client's record, even directly", async () => {
    const { project } = await makeAcceptedProject();
    const pm = await makeActor("project_manager");
    const other = await makeClient();
    await expect(
      db.portalShare.create({
        data: { clientId: other.id, kind: "PROJECT", projectId: project.id, sharedById: pm.id },
      }),
    ).rejects.toThrow(/client's own records/);
  });

  it("refuses unissued quotations", async () => {
    const entity = await makeQuotingEntity();
    const client = await makeClient();
    const sales = await makeActor("sales");
    const quote = await createQuote(sales, {
      legalEntityId: entity.id,
      clientId: client.id,
      title: "Draft only",
    });
    await expect(shareWithClient(sales, { kind: "QUOTE", id: quote.id })).rejects.toThrow(
      ConflictError,
    );
  });

  it("drops a portal user who loses access", async () => {
    const { client, project } = await makeAcceptedProject();
    const pm = await makeActor("project_manager");
    await shareWithClient(pm, { kind: "PROJECT", id: project.id });
    const asha = await portalUser(client.id);
    await revokePortalAccount(await makeActor("sales"), asha.accountId, {
      reason: "Left the company",
    });
    const user = await db.user.findUniqueOrThrow({ where: { id: asha.id } });
    expect(await portalActorFor(user)).toBeNull();
  });

  it("checks each portal permission", async () => {
    const { client, project } = await makeAcceptedProject();
    const pm = await makeActor("project_manager");
    await shareWithClient(pm, { kind: "PROJECT", id: project.id });
    const limited = await portalUser(client.id, ["projects.view"]);
    await expect(listSharedQuotes(limited)).rejects.toThrow(ForbiddenError);
    await expect(listClientInvoices(limited)).rejects.toThrow(ForbiddenError);
    await expect(listSharedDocuments(limited)).rejects.toThrow(ForbiddenError);
    await expect(
      submitProjectInformation(limited, project.id, { subject: "a", body: "b" }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("answering a quotation in the portal", () => {
  it("accepts with evidence, creates the project and tells the owner", async () => {
    const { client, sales, quote } = await issuedQuote();
    await shareWithClient(sales, { kind: "QUOTE", id: quote.id });
    const asha = await portalUser(client.id);
    expect((await listSharedQuotes(asha)).map((q) => q.id)).toEqual([quote.id]);

    const shown = await getSharedQuote(asha, quote.id);
    expect(shown).toMatchObject({ canRespond: true, expired: false, revising: false });
    const text = JSON.stringify(shown, (_, v) => (typeof v === "bigint" ? v.toString() : v));
    expect(text).not.toMatch(/cost|margin|internalNotes|thin/i);

    const result = await respondToQuote(asha, quote.id, {
      response: "ACCEPTED",
      typedName: "Asha Rao",
      contentSha256: shown.contentSha256,
      confirm: true,
    });
    expect(result.response).toBe("ACCEPTED");

    const version = await db.quoteVersion.findFirstOrThrow({ where: { quoteId: quote.id } });
    expect(version).toMatchObject({
      status: "ACCEPTED",
      acceptanceMethod: "PORTAL",
      acceptedByName: "Asha Rao",
      answerRecordedById: asha.id,
    });
    const evidence = await portalResponseFor(sales, version.id);
    expect(evidence).toMatchObject({
      response: "ACCEPTED",
      typedName: "Asha Rao",
      userId: asha.id,
      totalMinor: version.totalMinor,
      contentSha256: shown.contentSha256,
      ipAddress: "203.0.113.7",
      userAgent: "vitest",
    });
    expect(evidence?.statement).toContain("not an electronic signature");
    await expect(
      db.quotePortalResponse.update({ where: { id: evidence!.id }, data: { typedName: "X" } }),
    ).rejects.toThrow();

    const project = await db.project.findUniqueOrThrow({ where: { id: result.projectId! } });
    expect(project).toMatchObject({ clientId: client.id, createdById: sales.id });
    const note = await db.notification.findFirstOrThrow({
      where: { userId: sales.id, kind: "portal.client_activity" },
    });
    expect(note.title).toBe(`The client accepted quotation ${quote.number} in the portal`);
    await expect(
      db.auditEvent.findFirstOrThrow({ where: { action: "quote.accepted", actorId: asha.id } }),
    ).resolves.toMatchObject({ metadata: expect.objectContaining({ via: "portal" }) });

    // Answered is answered.
    expect((await getSharedQuote(asha, quote.id)).canRespond).toBe(false);
    await expect(
      respondToQuote(asha, quote.id, {
        response: "ACCEPTED",
        typedName: "Asha Rao",
        contentSha256: shown.contentSha256,
        confirm: true,
      }),
    ).rejects.toThrow(ConflictError);
  });

  it("refuses an acceptance of something other than what is issued now", async () => {
    const { client, sales, quote } = await issuedQuote();
    await shareWithClient(sales, { kind: "QUOTE", id: quote.id });
    const asha = await portalUser(client.id);
    const shown = await getSharedQuote(asha, quote.id);
    const accept = (hash: string) =>
      respondToQuote(asha, quote.id, {
        response: "ACCEPTED",
        typedName: "Asha Rao",
        contentSha256: hash,
        confirm: true,
      });
    await expect(accept("0".repeat(64))).rejects.toThrow(ConflictError);
    await expect(
      respondToQuote(asha, quote.id, {
        response: "ACCEPTED",
        typedName: "Asha Rao",
        contentSha256: shown.contentSha256,
        confirm: false,
      }),
    ).rejects.toThrow(ValidationError);

    // HMBL starts a new version: the issued one can no longer be answered.
    await reviseQuote(sales, quote.id);
    expect(await getSharedQuote(asha, quote.id)).toMatchObject({
      canRespond: false,
      revising: true,
    });
    await expect(accept(shown.contentSha256)).rejects.toThrow(ConflictError);
    expect(await db.quotePortalResponse.count()).toBe(0);
  });

  it("refuses an expired quotation and asks for the PO when it's needed", async () => {
    const expired = await issuedQuote();
    // It lapses after it was issued. Issued versions are frozen, so step past the guard.
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.quoteVersion.updateMany({
        where: { quoteId: expired.quote.id },
        data: { validUntil: new Date("2020-01-01T00:00:00Z") },
      });
    });
    await shareWithClient(expired.sales, { kind: "QUOTE", id: expired.quote.id });
    const asha = await portalUser(expired.client.id);
    const shown = await getSharedQuote(asha, expired.quote.id);
    expect(shown).toMatchObject({ canRespond: false, expired: true });
    await expect(
      respondToQuote(asha, expired.quote.id, {
        response: "ACCEPTED",
        typedName: "Asha Rao",
        contentSha256: shown.contentSha256,
        confirm: true,
      }),
    ).rejects.toThrow(/expired/);

    const po = await issuedQuote({ poRequired: true });
    await shareWithClient(po.sales, { kind: "QUOTE", id: po.quote.id });
    const ravi = await portalUser(po.client.id);
    const hash = (await getSharedQuote(ravi, po.quote.id)).contentSha256;
    const accept = (clientPoNumber?: string) =>
      respondToQuote(ravi, po.quote.id, {
        response: "ACCEPTED",
        typedName: "Ravi",
        clientPoNumber,
        contentSha256: hash,
        confirm: true,
      });
    await expect(accept()).rejects.toThrow(ValidationError);
    await accept("PO-778");
    const project = await db.project.findFirstOrThrow({ where: { quoteId: po.quote.id } });
    expect(project.clientPoNumber).toBe("PO-778");
  });

  it("records a decline with its reason", async () => {
    const { client, sales, quote } = await issuedQuote();
    await shareWithClient(sales, { kind: "QUOTE", id: quote.id });
    const asha = await portalUser(client.id);
    const { contentSha256 } = await getSharedQuote(asha, quote.id);
    await expect(
      respondToQuote(asha, quote.id, {
        response: "DECLINED",
        typedName: "Asha Rao",
        reason: "",
        contentSha256,
      }),
    ).rejects.toThrow(ValidationError);
    await respondToQuote(asha, quote.id, {
      response: "DECLINED",
      typedName: "Asha Rao",
      reason: "Over budget this year",
      contentSha256,
    });
    const version = await db.quoteVersion.findFirstOrThrow({ where: { quoteId: quote.id } });
    expect(version).toMatchObject({ status: "DECLINED", statusReason: "Over budget this year" });
    expect(await db.project.count({ where: { quoteId: quote.id } })).toBe(0);
    const note = await db.notification.findFirstOrThrow({ where: { userId: sales.id } });
    expect(note.body).toBe("Over budget this year");
  });

  it("can't be reached by another client or without the quotation shared", async () => {
    const { client, sales, quote } = await issuedQuote();
    const asha = await portalUser(client.id);
    await expect(getSharedQuote(asha, quote.id)).rejects.toThrow(NotFoundError);
    await shareWithClient(sales, { kind: "QUOTE", id: quote.id });
    const other = await portalUser((await makeClient()).id);
    await expect(getSharedQuote(other, quote.id)).rejects.toThrow(NotFoundError);
    await expect(
      respondToQuote(other, quote.id, {
        response: "DECLINED",
        typedName: "X",
        reason: "Y",
        contentSha256: "0".repeat(64),
      }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("client information", () => {
  it("reaches the project page and its manager, and can't be changed", async () => {
    const { client, project } = await makeAcceptedProject();
    const pm = await makeActor("project_manager");
    await db.project.update({ where: { id: project.id }, data: { projectManagerId: pm.id } });
    const asha = await portalUser(client.id);
    await expect(
      submitProjectInformation(asha, project.id, { subject: "Access", body: "Gate 3" }),
    ).rejects.toThrow(NotFoundError);
    await shareWithClient(pm, { kind: "PROJECT", id: project.id });
    const sent = await submitProjectInformation(asha, project.id, {
      subject: "Venue access",
      body: "Load-in through gate 3 after 22:00.",
    });
    expect((await mySubmissions(asha, project.id)).map((s) => s.id)).toEqual([sent.id]);
    const other = await portalUser((await makeClient()).id);
    expect(await mySubmissions(other, project.id)).toEqual([]);

    const activity = await projectPortalActivity(pm, project.id);
    expect(activity[0]).toMatchObject({ subject: "Venue access" });
    expect(activity[0]!.account.user.email).toBe(asha.email);
    const note = await db.notification.findFirstOrThrow({
      where: { userId: pm.id, kind: "portal.client_activity" },
    });
    expect(note.href).toBe(`/projects/${project.id}`);
    await expect(
      db.portalSubmission.update({ where: { id: sent.id }, data: { body: "changed" } }),
    ).rejects.toThrow();
  });
});

describe("client invoices", () => {
  it("lists issued invoices only, with what is due and where to pay", async () => {
    const { entity } = await makeBooks();
    const client = await makeBillableClient();
    const finance = await makeActor("finance");
    const issued = await issueSimpleInvoice(finance, entity.id, client.id);
    await createInvoice(finance, entity.id, { clientId: client.id }); // a draft
    const asha = await portalUser(client.id);
    const invoices = await listClientInvoices(asha);
    expect(invoices.map((i) => i.id)).toEqual([issued.id]);
    expect(invoices[0]).toMatchObject({ outstandingMinor: issued.totalMinor });

    const { invoice } = await getClientInvoice(asha, issued.id);
    expect(invoice.number).toBe(issued.number);
    const other = await portalUser((await makeBillableClient()).id);
    expect(await listClientInvoices(other)).toEqual([]);
    await expect(getClientInvoice(other, issued.id)).rejects.toThrow(NotFoundError);
  });
});

describe("shared documents", () => {
  it("shares standard documents only, follows new versions and stops when archived", async () => {
    const { client, project } = await makeAcceptedProject();
    const owner = await makeActor("owner");
    const ref = { type: "PROJECT" as const, id: project.id };
    const plan = await uploadDocument(
      owner,
      ref,
      { category: "TECHNICAL", fileName: "stage-plan.pdf" },
      body("v1"),
    );
    const secret = await uploadDocument(
      owner,
      ref,
      { category: "CONTRACT", fileName: "crew-rates.pdf", restricted: "on" },
      body("rates"),
    );
    await expect(shareWithClient(owner, { kind: "DOCUMENT", id: secret.id })).rejects.toThrow(
      NotFoundError,
    );
    await shareWithClient(owner, { kind: "DOCUMENT", id: plan.id });
    const asha = await portalUser(client.id);
    const [shown] = await listSharedDocuments(asha);
    expect(shown).toMatchObject({ title: plan.title, version: 1 });
    const { doc } = await openSharedDocument(asha, shown!.shareId);
    expect(doc.id).toBe(plan.id);

    const v2 = await uploadDocument(
      owner,
      ref,
      { category: "TECHNICAL", fileName: "stage-plan-v2.pdf", previousVersionId: plan.id },
      body("v2"),
    );
    expect((await openSharedDocument(asha, shown!.shareId)).doc.id).toBe(v2.id);
    // Sharing the new version is the same share.
    await shareWithClient(owner, { kind: "DOCUMENT", id: v2.id });
    expect(await db.portalShare.count({ where: { kind: "DOCUMENT" } })).toBe(1);

    const other = await portalUser((await makeClient()).id);
    await expect(openSharedDocument(other, shown!.shareId)).rejects.toThrow(NotFoundError);
    expect(await listSharedDocuments(other)).toEqual([]);

    await stopSharing(owner, { kind: "DOCUMENT", id: v2.id });
    expect(await listSharedDocuments(asha)).toEqual([]);
  });
});
