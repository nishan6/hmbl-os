import { expect, test } from "@playwright/test";

// Demo accounts from prisma/seed.ts. Run `pnpm db:seed` before these tests.
const OWNER = { email: "owner@demo.hmbl.test", password: "demo-password-2026" };

test("anonymous visitors are sent to sign in, then back where they were going", async ({
  page,
}) => {
  await page.goto("/settings?tab=1");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fsettings%3Ftab%3D1$/);
  await expect(page.getByRole("heading", { name: "Sign in to HMBL OS" })).toBeVisible();
});

test("a wrong password shows one generic error", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByText("That email and password don't match an active account."),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in/);
});

test("an owner signs in, sees their roles, and signs out", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(OWNER.email);
  await page.getByLabel("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByRole("heading", { name: "Home" })).toBeVisible();
  await expect(page.getByText(`Signed in as ${OWNER.email}`)).toContainText("owner");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
});
