import type { Grant } from "@/server/permissions/evaluate";

/**
 * DEFAULT POLICY (docs/decisions.md, "Multi-factor authentication"): these
 * roles can move money or change who has access, so they must use an
 * authenticator app. Everyone else may turn it on. Change the list here.
 */
export const TWO_FACTOR_REQUIRED_ROLES: readonly string[] = ["owner", "administrator", "finance"];

export function requiresTwoFactor(grants: Grant[]): boolean {
  return grants.some((g) => TWO_FACTOR_REQUIRED_ROLES.includes(g.roleKey));
}

/**
 * Until a user who must use two-factor has set it up, they hold no
 * permissions at all: every page and service denies them by default.
 */
export function applyTwoFactorPolicy(grants: Grant[], twoFactorEnabled: boolean) {
  const required = requiresTwoFactor(grants);
  return {
    required,
    setupRequired: required && !twoFactorEnabled,
    grants: required && !twoFactorEnabled ? [] : grants,
  };
}
