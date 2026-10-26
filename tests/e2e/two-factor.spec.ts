import { expect, test } from "@playwright/test";
import { totpCode } from "../helpers/totp";
import { DEMO, DEMO_PASSWORD, enterPassword, signIn } from "./helpers/session";

test("an owner must enter a code after the password", async ({ page }) => {
  await enterPassword(page, DEMO.owner);
  await expect(page.getByLabel("6-digit code")).toBeVisible();

  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("That code didn't work.")).toBeVisible();
  await expect(page).toHaveURL(/\/sign-in/);
});

test("finance without two-factor must set it up before seeing anything", async ({ page }) => {
  await enterPassword(page, DEMO.newFinance);
  await expect(page.getByRole("heading", { name: "Set up two-factor sign-in" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);

  await page.goto("/admin/organisation");
  await expect(page.getByRole("heading", { name: "Set up two-factor sign-in" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Organisation" })).toHaveCount(0);
});

test("a project manager turns on two-factor, signs in with it, then turns it off", async ({
  page,
}) => {
  await signIn(page, DEMO.projectManager);
  await page.goto("/account/security");
  await expect(page.getByText("Off", { exact: true })).toBeVisible();

  await page
    .getByRole("region", { name: "Two-factor sign-in" })
    .getByLabel("Current password")
    .fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("img", { name: "QR code for your authenticator app" })).toBeVisible();
  const key = (await page.getByTestId("totp-key").innerText()).replace(/\s/g, "");
  const uri = `otpauth://totp/HMBL%20OS?secret=${key}`;

  await page.getByLabel("6-digit code").fill(totpCode(uri));
  await page.getByRole("button", { name: "Turn on two-factor" }).click();
  await expect(page.getByRole("list", { name: "Backup codes" }).getByRole("listitem")).toHaveCount(
    10,
  );
  await page.getByRole("button", { name: "I've saved them" }).click();
  await expect(page.getByText("On", { exact: true })).toBeVisible();

  // Signing in again now asks for a code.
  await page.getByRole("button", { name: "Account: Demo Project Manager" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await enterPassword(page, DEMO.projectManager);
  await page.getByLabel("6-digit code").fill(totpCode(uri));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^Good to see you/ })).toBeVisible();

  // Leave the demo account as it was.
  await page.goto("/account/security");
  await page.getByRole("button", { name: "Turn off" }).click();
  await page
    .getByRole("region", { name: "Two-factor sign-in" })
    .getByLabel("Current password")
    .fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Turn off two-factor" }).click();
  await expect(page.getByText("Off", { exact: true })).toBeVisible();
});
