import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers/session";

test("anonymous visitors are sent to sign in, then back where they were going", async ({
  page,
}) => {
  await page.goto("/settings?tab=1");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fsettings%3Ftab%3D1$/);
  await expect(page.getByRole("heading", { name: "Sign in to HMBL OS" })).toBeVisible();
});

test("a wrong password shows one generic error", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(DEMO.owner);
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByText("That email and password don't match an active account."),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in/);
});

test("an owner signs in, sees their roles, and signs out", async ({ page }) => {
  await signIn(page, DEMO.owner);
  await expect(page.getByRole("region", { name: "Your access" })).toContainText("owner");

  await page.getByRole("button", { name: "Account: Demo Owner" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/sign-in$/);
});
