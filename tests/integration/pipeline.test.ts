import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createContact, mergeClient } from "@/server/crm/clients";
import {
  createOpportunity,
  createStage,
  getOpportunity,
  listOpportunities,
  moveOpportunity,
  moveStage,
  setStageArchived,
  updateOpportunity,
  updateStage,
  listStages,
} from "@/server/crm/pipeline";
import {
  completeActivity,
  createActivity,
  listActivities,
  listMyFollowUps,
} from "@/server/crm/activities";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { makeActor, makeScopedActor } from "../helpers/actors";
import { makeEntity } from "../helpers/organisation";
import { makeClient, stages } from "../helpers/crm";

async function setup() {
  const s = await stages();
  const entity = await makeEntity();
  const client = await makeClient();
  const sales = await makeActor("sales");
  const input = {
    legalEntityId: entity.id,
    clientId: client.id,
    title: "Arena tour 2027",
    currency: "INR",
    expectedValue: "12,50,000",
  };
  return { s, entity, client, sales, input };
}

describe("opportunities", () => {
  it("start in the first open stage, owned by their creator, with history", async () => {
    const { s, sales, input } = await setup();
    const o = await createOpportunity(sales, input);
    expect(o).toMatchObject({
      stageId: s.new!.id,
      ownerId: sales.id,
      expectedValueMinor: 125000000n,
      closedAt: null,
    });
    const full = await getOpportunity(sales, o.id);
    expect(full.stageChanges).toMatchObject([{ fromStageId: null, toStageId: s.new!.id }]);
    const event = await db.auditEvent.findFirst({ where: { action: "opportunity.created" } });
    expect(event).toMatchObject({ legalEntityId: input.legalEntityId });
    expect(event?.changes).toMatchObject({ expectedValueMinor: { to: "125000000" } });
  });

  it("validates amounts, dates, stages and that the contact belongs to the client", async () => {
    const { s, sales, input } = await setup();
    const other = await makeClient();
    const otherContact = await createContact(sales, other.id, { name: "Someone else" });
    for (const bad of [
      { expectedValue: "lots" },
      { expectedValue: "-5" },
      { expectedValue: "1.234" },
      { eventStartDate: "2027-02-10", eventEndDate: "2027-02-01" },
      { stageId: s.won!.id },
      { contactId: otherContact.id },
      { probability: "120" },
    ]) {
      await expect(createOpportunity(sales, { ...input, ...bad })).rejects.toBeInstanceOf(
        ValidationError,
      );
    }
  });

  it("is scoped to its legal entity", async () => {
    const { sales, input, entity } = await setup();
    const o = await createOpportunity(sales, input);
    const elsewhere = await makeScopedActor("sales", (await makeEntity()).id);
    await expect(getOpportunity(elsewhere, o.id)).rejects.toBeInstanceOf(NotFoundError);
    expect(await listOpportunities(elsewhere)).toHaveLength(0);
    await expect(createOpportunity(elsewhere, input)).rejects.toBeInstanceOf(ForbiddenError);
    const here = await makeScopedActor("sales", entity.id);
    expect(await listOpportunities(here)).toHaveLength(1);
    await expect(createOpportunity(await makeActor("viewer"), input)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("can't move to another entity or change stage through an edit", async () => {
    const { s, sales, input } = await setup();
    const o = await createOpportunity(sales, input);
    const other = await makeEntity();
    await expect(
      updateOpportunity(sales, o.id, { ...input, legalEntityId: other.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    const after = await updateOpportunity(sales, o.id, {
      ...input,
      stageId: s.negotiation!.id,
      venue: "NSCI Dome",
    });
    expect(after).toMatchObject({ stageId: s.new!.id, venue: "NSCI Dome" });
  });

  it("follows the stage rules: reasons for losing and reopening, closed dates", async () => {
    const { s, sales, input } = await setup();
    const o = await createOpportunity(sales, input);
    await moveOpportunity(sales, o.id, { stageId: s.proposal_sent!.id });
    await expect(moveOpportunity(sales, o.id, { stageId: s.lost!.id })).rejects.toBeInstanceOf(
      ValidationError,
    );
    const lost = await moveOpportunity(sales, o.id, {
      stageId: s.lost!.id,
      reason: "Went with a competitor",
    });
    expect(lost.closedAt).toBeInstanceOf(Date);
    expect(lost.outcomeReason).toBe("Went with a competitor");
    // Closed opportunities leave the open pipeline.
    expect(await listOpportunities(sales, { open: true })).toHaveLength(0);

    await expect(
      moveOpportunity(sales, o.id, { stageId: s.negotiation!.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    const reopened = await moveOpportunity(sales, o.id, {
      stageId: s.negotiation!.id,
      reason: "Competitor dropped out",
    });
    expect(reopened).toMatchObject({ closedAt: null, outcomeReason: null });

    const history = (await getOpportunity(sales, o.id)).stageChanges;
    expect(history).toHaveLength(4);
    expect(history[0]).toMatchObject({
      toStageId: s.negotiation!.id,
      reason: "Competitor dropped out",
    });
    expect(
      await db.auditEvent.count({ where: { targetId: o.id, action: "opportunity.reopened" } }),
    ).toBe(1);
  });

  it("moves with its client when the client is merged", async () => {
    const { sales, input, client } = await setup();
    const o = await createOpportunity(sales, input);
    const keep = await makeClient();
    await mergeClient(sales, client.id, { targetId: keep.id, reason: "Duplicate" });
    expect((await getOpportunity(sales, o.id)).clientId).toBe(keep.id);
  });
});

describe("pipeline stages", () => {
  it("are configured by someone with crm.configure everywhere", async () => {
    await stages();
    const owner = await makeActor("owner");
    await expect(
      createStage(await makeActor("sales"), { name: "Tender", kind: "OPEN" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const tender = await createStage(owner, {
      name: "Tender submitted",
      kind: "OPEN",
      probability: "50",
    });
    expect(tender).toMatchObject({ key: "tender_submitted", probabilityBps: 5000 });
    const renamed = await updateStage(owner, tender.id, { name: "Tender", probability: "" });
    expect(renamed).toMatchObject({ name: "Tender", probabilityBps: null, kind: "OPEN" });
  });

  it("reorder by swapping neighbours", async () => {
    const s = await stages();
    const owner = await makeActor("owner");
    await moveStage(owner, s.qualified!.id, "up");
    const order = (await listStages(owner)).map((x) => x.key);
    expect(order.slice(0, 3)).toEqual(["qualified", "new", "discovery"]);
  });

  it("can't be archived while in use, or if it's the last of its kind", async () => {
    const { s, sales, input } = await setup();
    const owner = await makeActor("owner");
    await createOpportunity(sales, input);
    await expect(setStageArchived(owner, s.new!.id, true)).rejects.toBeInstanceOf(ConflictError);
    await expect(setStageArchived(owner, s.won!.id, true)).rejects.toBeInstanceOf(ConflictError);
    await setStageArchived(owner, s.discovery!.id, true);
    await expect(
      moveOpportunity(sales, (await listOpportunities(sales))[0]!.id, { stageId: s.discovery!.id }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("activities", () => {
  it("records notes and follow-ups on an opportunity and lists my open follow-ups", async () => {
    const { sales, input } = await setup();
    const o = await createOpportunity(sales, input);
    await createActivity(sales, { opportunityId: o.id }, { type: "CALL", subject: "Intro call" });
    await expect(
      createActivity(sales, { opportunityId: o.id }, { type: "FOLLOW_UP", subject: "Send deck" }),
    ).rejects.toBeInstanceOf(ValidationError);
    const followUp = await createActivity(
      sales,
      { opportunityId: o.id },
      { type: "FOLLOW_UP", subject: "Send deck", dueAt: "2027-01-10T10:00" },
    );
    expect(followUp.clientId).toBe(input.clientId);
    expect(await listMyFollowUps(sales)).toHaveLength(1);
    await completeActivity(sales, followUp.id);
    expect(await listMyFollowUps(sales)).toHaveLength(0);
    expect(await listActivities(sales, { opportunityId: o.id })).toHaveLength(2);
  });

  it("hides another entity's opportunity activities on the shared client page", async () => {
    const { sales, input, client } = await setup();
    const o = await createOpportunity(sales, input);
    await createActivity(
      sales,
      { opportunityId: o.id },
      { type: "NOTE", subject: "Pricing notes" },
    );
    await createActivity(sales, { clientId: client.id }, { type: "NOTE", subject: "General" });
    const elsewhere = await makeScopedActor("sales", (await makeEntity()).id);
    expect(
      (await listActivities(elsewhere, { clientId: client.id })).map((a) => a.subject),
    ).toEqual(["General"]);
    expect(await listActivities(sales, { clientId: client.id })).toHaveLength(2);
  });
});
