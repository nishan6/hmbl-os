import { expect, type Page } from "@playwright/test";

// Demo accounts from prisma/seed.ts. Run `pnpm db:seed` before the e2e suite.
export const DEMO_PASSWORD = "demo-password-2026";
export const DEMO = {
  owner: "owner@demo.hmbl.test",
  sales: "sales@demo.hmbl.test",
  viewer: "viewer@demo.hmbl.test",
} as const;

export async function signIn(page: Page, email: string, password = DEMO_PASSWORD) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^Good to see you/ })).toBeVisible();
}
