import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { auth } from "@/server/auth/auth";
import { listAuditEvents } from "@/server/audit/query";
import { recordAudit } from "@/server/audit/record";
import {
  createBusinessUnit,
  createCostCentre,
  createLegalEntity,
  updateLegalEntity,
} from "@/server/organisation/service";
import { assignRole, disableUser, revokeRole } from "@/server/users/service";
import { ConflictError, ForbiddenError } from "@/lib/errors";
import { makeActor, makeScopedActor, TEST_PASSWORD } from "../helpers/actors";
import { makeEntity } from "../helpers/organisation";

const entityInput = {
  code: "AUD-IN",
  legalName: "Audit Test Pvt Ltd",
  countryCode: "IN",
  baseCurrency: "INR",
  timezone: "Asia/Kolkata",
};

describe("audit log storage", () => {
  it("rejects updates and deletes at the database level", async () => {
    const event = await recordAudit(db, "system", { action: "test.event", targetType: "test" });
    await expect(
      db.auditEvent.update({ where: { id: event.id }, data: { action: "tampered" } }),
    ).rejects.toThrow(/append-only/);
    await expect(db.auditEvent.delete({ where: { id: event.id } })).rejects.toThrow(/append-only/);
    await expect(db.$executeRaw`DELETE FROM audit_events`).rejects.toThrow(/append-only/);
  });

  it("records the actor and request context", async () => {
    const owner = await makeActor("owner");
    const withRequest = { ...owner, request: { ipAddress: "203.0.113.7", userAgent: "test" } };
    const entity = await createLegalEntity(withRequest, entityInput);
    const [event] = await db.auditEvent.findMany({ where: { action: "legal_entity.created" } });
    expect(event).toMatchObject({
      actorType: "USER",
      actorId: owner.id,
      actorLabel: `${owner.name} <${owner.email}>`,
      targetType: "legal_entity",
      targetId: entity.id,
      legalEntityId: entity.id,
      metadata: { ipAddress: "203.0.113.7", userAgent: "test" },
    });
    expect(event!.changes).toMatchObject({ code: { from: null, to: "AUD-IN" } });
  });

  it("writes nothing when the change itself fails", async () => {
    const owner = await makeActor("owner");
    await createLegalEntity(owner, entityInput);
    await expect(createLegalEntity(owner, entityInput)).rejects.toBeInstanceOf(ConflictError);
    expect(await db.auditEvent.count({ where: { action: "legal_entity.created" } })).toBe(1);
  });
});

describe("audited changes", () => {
  it("records field-level changes on update, and nothing for a no-op", async () => {
    const owner = await makeActor("owner");
    const entity = await createLegalEntity(owner, entityInput);
    await updateLegalEntity(owner, entity.id, { ...entityInput, city: "Pune" });
    await updateLegalEntity(owner, entity.id, { ...entityInput, city: "Pune" });
    const updates = await db.auditEvent.findMany({ where: { action: "legal_entity.updated" } });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.changes).toEqual({ city: { from: null, to: "Pune" } });
  });

  it("records role grants, revocations and disabling with scope", async () => {
    const owner = await makeActor("owner");
    const target = await makeActor();
    const entity = await makeEntity();
    await assignRole(owner, target.id, "finance", entity.id);
    await assignRole(owner, target.id, "finance", entity.id); // no-op, not audited
    await revokeRole(owner, target.id, "finance", entity.id);
    await revokeRole(owner, target.id, "finance", entity.id); // no-op, not audited
    await db.session.create({
      data: { userId: target.id, token: "t", expiresAt: new Date(Date.now() + 60_000) },
    });
    await disableUser(owner, target.id);

    const events = await db.auditEvent.findMany({
      where: { targetId: target.id, action: { not: "user.created" } },
      orderBy: { occurredAt: "asc" },
    });
    expect(events.map((e) => e.action)).toEqual([
      "user.role_granted",
      "user.role_revoked",
      "user.disabled",
    ]);
    expect(events[0]).toMatchObject({
      legalEntityId: entity.id,
      metadata: { role: "finance", scope: entity.id },
    });
    expect(events[2]!.metadata).toMatchObject({ sessionsRevoked: 1 });
  });

  it("marks bootstrap changes as made by the system", async () => {
    await makeActor("owner");
    const [created] = await db.auditEvent.findMany({ where: { action: "user.created" } });
    expect(created).toMatchObject({ actorType: "SYSTEM", actorId: null, actorLabel: "System" });
  });
});

describe("sign-in events", () => {
  const signIn = (email: string, password: string) =>
    auth.api.signInEmail({
      body: { email, password },
      headers: new Headers({ "user-agent": "vitest", "x-forwarded-for": "198.51.100.1" }),
      asResponse: true,
    });

  it("records successful, failed and blocked sign-ins", async () => {
    const owner = await makeActor("owner");
    const user = await makeActor("viewer");
    await signIn(user.email, TEST_PASSWORD);
    await signIn(user.email, "wrong-password-123");
    await disableUser(owner, user.id);
    await signIn(user.email, TEST_PASSWORD);

    const events = await db.auditEvent.findMany({
      where: { action: { startsWith: "auth." } },
      orderBy: { occurredAt: "asc" },
    });
    // A blocked attempt is also a failed attempt; the blocked event says why.
    expect(events.map((e) => e.action)).toEqual([
      "auth.signed_in",
      "auth.sign_in_failed",
      "auth.sign_in_blocked",
      "auth.sign_in_failed",
    ]);
    expect(events[2]!.metadata).toMatchObject({ reason: "user disabled" });
    expect(events[0]).toMatchObject({ actorId: user.id, targetId: user.id });
    expect(events[1]).toMatchObject({
      actorType: "ANONYMOUS",
      targetId: user.id,
      metadata: { email: user.email, ipAddress: "198.51.100.1", userAgent: "vitest" },
    });
  });
});

describe("reading the audit log", () => {
  it("needs audit.view", async () => {
    const sales = await makeActor("sales");
    await expect(listAuditEvents(sales)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("shows a scoped auditor only their entity's events", async () => {
    const owner = await makeActor("owner");
    const india = await makeEntity({ code: "IN-1" });
    const uk = await makeEntity({ code: "UK-1" });
    await createCostCentre(owner, { legalEntityId: india.id, code: "OPS", name: "Ops" });
    await createCostCentre(owner, { legalEntityId: uk.id, code: "OPS", name: "Ops" });
    await createBusinessUnit(owner, { code: "LIVE", name: "Live" });

    const scopedFinance = await makeScopedActor("finance", india.id);
    const { events } = await listAuditEvents(scopedFinance);
    // Their own grant (made for india) and india's cost centre; nothing from the UK
    // entity, and no group-wide events such as the business unit.
    expect(events.map((e) => [e.action, e.legalEntityId]).sort()).toEqual([
      ["cost_centre.created", india.id],
      ["user.role_granted", india.id],
    ]);

    const all = await listAuditEvents(owner, { action: "cost_centre.created" });
    expect(all.events).toHaveLength(2);
  });

  it("pages newest first with a cursor", async () => {
    const owner = await makeActor("owner");
    for (let i = 0; i < 5; i++) {
      await recordAudit(db, "system", {
        action: "test.page",
        targetType: "test",
        targetId: `${i}`,
      });
    }
    const first = await listAuditEvents(owner, { action: "test.page", limit: 2 });
    const second = await listAuditEvents(owner, {
      action: "test.page",
      limit: 2,
      cursor: first.nextCursor!,
    });
    const third = await listAuditEvents(owner, {
      action: "test.page",
      limit: 2,
      cursor: second.nextCursor!,
    });
    const ids = [...first.events, ...second.events, ...third.events].map((e) => e.targetId);
    expect(new Set(ids).size).toBe(5);
    expect(third.nextCursor).toBeNull();
  });
});
