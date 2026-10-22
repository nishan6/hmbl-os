import { describe, expect, it } from "vitest";
import { applyTwoFactorPolicy, requiresTwoFactor } from "@/server/auth/two-factor-policy";
import type { Grant } from "@/server/permissions/evaluate";

const grant = (roleKey: string, legalEntityId: string | null = null): Grant => ({
  roleKey,
  legalEntityId,
  permissions: new Set(["organisation.view"]),
});

describe("two-factor policy", () => {
  it("requires it for owners, administrators and finance, scoped or not", () => {
    expect(requiresTwoFactor([grant("owner")])).toBe(true);
    expect(requiresTwoFactor([grant("administrator")])).toBe(true);
    expect(requiresTwoFactor([grant("finance", "entity-1")])).toBe(true);
    expect(requiresTwoFactor([grant("viewer"), grant("sales")])).toBe(false);
  });

  it("withholds every permission until a required user sets it up", () => {
    const grants = [grant("finance")];
    expect(applyTwoFactorPolicy(grants, false)).toEqual({
      required: true,
      setupRequired: true,
      grants: [],
    });
    expect(applyTwoFactorPolicy(grants, true).grants).toBe(grants);
  });

  it("leaves optional users alone", () => {
    const grants = [grant("viewer")];
    expect(applyTwoFactorPolicy(grants, false)).toEqual({
      required: false,
      setupRequired: false,
      grants,
    });
  });
});
