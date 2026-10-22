import { expect, type Page } from "@playwright/test";
import { DEMO_PASSWORD, DEMO_TOTP_SECRET } from "../../../prisma/seed/demo-credentials";
import { totpCodeForSecret } from "../../helpers/totp";

// Demo accounts from prisma/seed.ts. Run `pnpm db:seed` before the e2e suite.
export { DEMO_PASSWORD };
export const DEMO = {
  owner: "owner@demo.hmbl.test",
  sales: "sales@demo.hmbl.test",
  viewer: "viewer@demo.hmbl.test",
  // Only the two-factor spec uses this one, since it changes the account.
  projectManager: "pm@demo.hmbl.test",
  newFinance: "new.finance@demo.hmbl.test",
} as const;

/** Password step only. */
export async function enterPassword(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Signs in, answering the two-factor step with the demo authenticator secret when asked. */
export async function signIn(page: Page, email: string, password = DEMO_PASSWORD) {
  await enterPassword(page, email, password);
  const home = page.getByRole("heading", { level: 1, name: /^Good to see you/ });
  const code = page.getByLabel("6-digit code");
  await expect(home.or(code)).toBeVisible();
  if (await code.isVisible()) {
    await code.fill(totpCodeForSecret(DEMO_TOTP_SECRET));
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await expect(home).toBeVisible();
}
