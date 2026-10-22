import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS, isPermission } from "@/server/permissions/catalog";
import { DEFAULT_ROLES } from "@/server/permissions/default-roles";
import { hasPermission, type Grant } from "@/server/permissions/evaluate";
import { authorize, type Actor } from "@/server/permissions/authorize";
import { ForbiddenError } from "@/lib/errors";

const role = (key: string) => DEFAULT_ROLES.find((r) => r.key === key)!;
const grant = (...permissions: string[]): Grant => ({
  roleKey: "r",
  permissions: new Set(permissions),
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

describe("authorize", () => {
  const actor: Actor = { id: "1", name: "A", email: "a@x.test", grants: [grant("crm.view")] };

  it("throws ForbiddenError without the permission", () => {
    expect(() => authorize(actor, "crm.edit")).toThrow(ForbiddenError);
  });

  it("passes with the permission", () => {
    expect(() => authorize(actor, "crm.view")).not.toThrow();
  });
});
