import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, isPermission } from "@/server/permissions/catalog";
import { DEFAULT_ROLES } from "@/server/permissions/default-roles";
import { entityReach, hasPermission, type Grant } from "@/server/permissions/evaluate";
import { authorize, entityFilter, type Actor } from "@/server/permissions/authorize";
import { ForbiddenError } from "@/lib/errors";

const role = (key: string) => DEFAULT_ROLES.find((r) => r.key === key)!;
const grant = (...permissions: string[]): Grant => ({
  roleKey: "r",
  legalEntityId: null,
  permissions: new Set(permissions),
});
const scoped = (legalEntityId: string, ...permissions: string[]): Grant => ({
  ...grant(...permissions),
  legalEntityId,
});

describe("permission catalog", () => {
  it("has unique, well-formed keys", () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
    for (const p of ALL_PERMISSIONS) expect(p).toMatch(/^[a-z]+\.[a-z_]+$/);
  });

  it("only allows posting and voiding in finance", () => {
    const ledger = ALL_PERMISSIONS.filter((p) => p.endsWith(".post") || p.endsWith(".void"));
    expect(ledger.sort()).toEqual(["finance.post", "finance.void"]);
  });
});

describe("default roles", () => {
  it("only use catalog permissions, without duplicates", () => {
    for (const r of DEFAULT_ROLES) {
      expect(r.permissions.every(isPermission), r.key).toBe(true);
      expect(new Set(r.permissions).size, r.key).toBe(r.permissions.length);
    }
  });

  it("give the owner every permission", () => {
    expect(new Set(role("owner").permissions)).toEqual(new Set(ALL_PERMISSIONS));
  });

  it("keep the viewer read-only and away from sensitive data", () => {
    expect(role("viewer").permissions.every((p) => p.endsWith(".view"))).toBe(true);
    expect(role("viewer").permissions).not.toContain("users.view");
  });

  it("let procurement raise orders but not approve them or see bank details", () => {
    const p = role("procurement").permissions;
    expect(p).toContain("procurement.submit");
    expect(p).not.toContain("procurement.approve");
    expect(p).not.toContain("procurement.view_sensitive");
    expect(p.some((x) => x.startsWith("finance."))).toBe(false);
  });

  it("do not let sales or project managers see sensitive finance data", () => {
    for (const key of ["sales", "project_manager"]) {
      expect(
        role(key).permissions.some((p) => p.endsWith(".view_sensitive")),
        key,
      ).toBe(false);
      expect(
        role(key).permissions.some((p) => p.startsWith("finance.")),
        key,
      ).toBe(false);
    }
  });

  it("do not let an administrator post or approve transactions", () => {
    const admin = role("administrator").permissions;
    expect(admin).not.toContain("finance.post");
    expect(admin.some((p) => p.endsWith(".approve"))).toBe(false);
  });
});

describe("hasPermission", () => {
  it("denies by default", () => {
    expect(hasPermission([], "crm.view")).toBe(false);
  });

  it("grants when any role lists the permission", () => {
    expect(hasPermission([grant("crm.view"), grant("finance.view")], "finance.view")).toBe(true);
  });

  it("does not treat one action as implying another", () => {
    expect(hasPermission([grant("finance.edit")], "finance.post")).toBe(false);
  });
});

describe("entity scope", () => {
  const grants = [scoped("in-1", "finance.view", "finance.post"), scoped("uk-1", "finance.view")];

  it("limits a scoped grant to its entity", () => {
    expect(hasPermission(grants, "finance.post", { legalEntityId: "in-1" })).toBe(true);
    expect(hasPermission(grants, "finance.post", { legalEntityId: "uk-1" })).toBe(false);
  });

  it("treats an unscoped grant as covering every entity", () => {
    expect(hasPermission([grant("crm.view")], "crm.view", { legalEntityId: "anything" })).toBe(
      true,
    );
  });

  it("answers module-level checks if any entity is covered", () => {
    expect(hasPermission(grants, "finance.post")).toBe(true);
  });

  it("reports which entities a permission reaches", () => {
    expect(entityReach(grants, "finance.view")).toEqual(new Set(["in-1", "uk-1"]));
    expect(entityReach(grants, "finance.post")).toEqual(new Set(["in-1"]));
    expect(entityReach(grants, "crm.view")).toEqual(new Set());
    expect(entityReach([...grants, grant("finance.view")], "finance.view")).toBe("all");
  });

  it("builds a query filter from the reach", () => {
    const actor: Actor = { id: "1", name: "A", email: "a@x.test", grants };
    expect(entityFilter(actor, "finance.post")).toEqual({ legalEntityId: { in: ["in-1"] } });
    expect(entityFilter({ ...actor, grants: [grant("finance.post")] }, "finance.post")).toEqual({});
  });
});

describe("authorize", () => {
  const actor: Actor = { id: "1", name: "A", email: "a@x.test", grants: [grant("crm.view")] };

  it("throws ForbiddenError without the permission", () => {
    expect(() => authorize(actor, "crm.edit")).toThrow(ForbiddenError);
  });

  it("passes with the permission", () => {
    expect(() => authorize(actor, "crm.view")).not.toThrow();
  });
});
