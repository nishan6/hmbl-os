import { describe, expect, it } from "vitest";
import { db } from "@/server/db";
import {
  addCertification,
  addCrewRate,
  addUnavailability,
  createCrewMember,
  endCrewRate,
  getCrewMember,
  listCrew,
  removeUnavailability,
  setCrewArchived,
  updateCrewMember,
} from "@/server/crew/members";
import { createVendor } from "@/server/vendors/service";
import { ForbiddenError } from "@/lib/errors";
import { makeActor } from "../helpers/actors";

async function makeFreelancerVendor() {
  const owner = await makeActor("owner");
  return createVendor(owner, {
    name: "Ravi Kumar",
    kind: "INDIVIDUAL",
    countryCode: "IN",
    currency: "INR",
    paymentTermsDays: "15",
    pan: "ABCPK1234F",
    tdsSection: "194J",
    tdsRate: "10",
  });
}

describe("crew records", () => {
  it("keeps freelancers with skills, a paying vendor and an emergency contact", async () => {
    const coordinator = await makeActor("crew_coordinator");
    const vendor = await makeFreelancerVendor();
    const ravi = await createCrewMember(coordinator, {
      name: "Ravi Kumar",
      kind: "FREELANCER",
      vendorId: vendor.id,
      phone: "+91 98640 00000",
      baseCity: "Guwahati",
      skills: "Lighting operator, grandMA3, lighting operator",
      emergencyContactName: "Meena Kumar",
      emergencyContactPhone: "+91 98640 11111",
    });
    expect(ravi.skills).toEqual(["Lighting operator", "grandMA3"]);
    expect(ravi.vendorId).toBe(vendor.id);

    // A project manager sees the person, not the pay link or emergency contact.
    const pm = await makeActor("project_manager");
    const seen = await getCrewMember(pm, ravi.id);
    expect(seen).toMatchObject({ name: "Ravi Kumar", vendorId: null, emergencyContactName: null });
    expect(seen.rates).toEqual([]);
    expect((await listCrew(pm, { skill: "grandMA3" })).map((c) => c.name)).toEqual(["Ravi Kumar"]);
    expect(await listCrew(pm, { skill: "Rigging" })).toEqual([]);

    // Their edit keeps the hidden fields as they were.
    await updateCrewMember(pm, ravi.id, {
      name: "Ravi Kumar",
      kind: "FREELANCER",
      skills: "Lighting operator, grandMA3, Rigging",
    });
    const after = await db.crewMember.findUniqueOrThrow({ where: { id: ravi.id } });
    expect(after).toMatchObject({ vendorId: vendor.id, emergencyContactName: "Meena Kumar" });
    expect(after.skills).toContain("Rigging");

    // Archiving needs crew.archive.
    await expect(setCrewArchived(pm, ravi.id, true)).rejects.toBeInstanceOf(ForbiddenError);
    await setCrewArchived(coordinator, ravi.id, true);
    expect(await listCrew(coordinator)).toEqual([]);

    const audit = await db.auditEvent.findMany({
      where: { targetId: ravi.id },
      orderBy: { occurredAt: "asc" },
    });
    expect(audit.map((a) => a.action)).toEqual([
      "crew_member.created",
      "crew_member.updated",
      "crew_member.archived",
    ]);
  });

  it("links staff to one user and refuses a vendor on them", async () => {
    const coordinator = await makeActor("crew_coordinator");
    const staff = await makeActor("project_manager");
    const vendor = await makeFreelancerVendor();
    const a = await createCrewMember(coordinator, {
      name: staff.name,
      kind: "EMPLOYEE",
      userId: staff.id,
      vendorId: vendor.id,
    });
    expect(a).toMatchObject({ userId: staff.id, vendorId: null });
    await expect(
      createCrewMember(coordinator, { name: "Someone else", kind: "EMPLOYEE", userId: staff.id }),
    ).rejects.toMatchObject({ fieldErrors: { userId: [expect.stringContaining(staff.name)] } });
  });

  it("replaces rates by ending the open one, and keeps them from people without access", async () => {
    const coordinator = await makeActor("crew_coordinator");
    const m = await createCrewMember(coordinator, { name: "Asha", kind: "FREELANCER" });
    const first = await addCrewRate(coordinator, m.id, {
      type: "DAY",
      currency: "INR",
      amount: "5000",
      validFrom: "2026-01-01",
    });
    await addCrewRate(coordinator, m.id, {
      type: "DAY",
      role: "Rigger",
      currency: "INR",
      amount: "6000",
      validFrom: "2026-01-01",
    });
    await addCrewRate(coordinator, m.id, {
      type: "DAY",
      currency: "INR",
      amount: "5500",
      validFrom: "2026-07-01",
    });
    const rates = await db.crewRate.findMany({ where: { crewMemberId: m.id } });
    expect(rates.find((r) => r.id === first.id)!.validTo).toEqual(new Date("2026-06-30"));
    // The role rate is a separate line, still open.
    expect(rates.filter((r) => r.validTo === null)).toHaveLength(2);

    // A rate can't start before the open one it would replace.
    await expect(
      addCrewRate(coordinator, m.id, {
        type: "DAY",
        currency: "INR",
        amount: "4000",
        validFrom: "2026-03-01",
      }),
    ).rejects.toMatchObject({ fieldErrors: { validFrom: [expect.any(String)] } });

    const pm = await makeActor("project_manager");
    await expect(
      addCrewRate(pm, m.id, { type: "DAY", currency: "INR", amount: "1", validFrom: "2026-01-01" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const open = rates.find((r) => r.validTo === null && r.role === null)!;
    await expect(endCrewRate(pm, open.id, { validTo: "2026-12-31" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await endCrewRate(coordinator, open.id, { validTo: "2026-12-31" });
    expect((await getCrewMember(coordinator, m.id)).rates).toHaveLength(3);
  });

  it("records certifications and time off", async () => {
    const coordinator = await makeActor("crew_coordinator");
    const m = await createCrewMember(coordinator, { name: "Dev", kind: "FREELANCER" });
    await addCertification(coordinator, m.id, {
      name: "Working at height",
      issuedOn: "2026-01-10",
      expiresOn: "2028-01-09",
    });
    await expect(
      addCertification(coordinator, m.id, {
        name: "Rigging",
        issuedOn: "2026-01-10",
        expiresOn: "2025-01-09",
      }),
    ).rejects.toMatchObject({ fieldErrors: { expiresOn: [expect.any(String)] } });
    const off = await addUnavailability(coordinator, m.id, {
      startDate: "2099-03-01",
      reason: "Wedding",
    });
    expect(off.endDate).toEqual(off.startDate);
    await expect(
      addUnavailability(coordinator, m.id, { startDate: "2099-03-05", endDate: "2099-03-01" }),
    ).rejects.toMatchObject({ fieldErrors: { endDate: [expect.any(String)] } });
    const seen = await getCrewMember(coordinator, m.id);
    expect(seen.certifications.map((c) => c.name)).toEqual(["Working at height"]);
    expect(seen.unavailability).toHaveLength(1);
    await removeUnavailability(coordinator, off.id);
    expect(await db.crewUnavailability.count()).toBe(0);
  });

  it("is hidden from people without crew access", async () => {
    const sales = await makeActor("sales");
    await expect(listCrew(sales)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
