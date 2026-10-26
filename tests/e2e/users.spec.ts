import { expect, test } from "@playwright/test";
import { DEMO, DEMO_PASSWORD, enterPassword, signIn } from "./helpers/session";

const NEW_PASSWORD = "a-brand-new-passphrase";

test("an owner invites a staff member, who joins, changes their password and is later disabled", async ({
  page,
}) => {
  const stamp = Date.now().toString(36);
  const email = `joiner.${stamp}@demo.hmbl.test`;
  const name = `Joiner ${stamp}`;

  await signIn(page, DEMO.owner);
  await page.goto("/admin/users");
  const links = page.getByRole("region", { name: "Open links" });
  await links.getByLabel("Name").fill(name);
  await links.getByLabel("Email").fill(email);
  await links.getByLabel("Role").selectOption({ label: "Viewer" });
  await links.getByRole("button", { name: "Create invitation" }).click();
  const link = await links.getByLabel("Link").inputValue();
  expect(link).toMatch(/\/sign-in\/link\/[A-Za-z0-9_-]{43}$/);
  await expect(links.getByRole("row", { name: new RegExp(email) })).toContainText("Invited");

  // The new starter, in a fresh browser.
  await page.context().clearCookies();
  await page.goto(new URL(link).pathname);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/invited you to HMBL OS$/);
  await page.getByLabel("Your email address").fill(email);
  await page.getByLabel("Choose a password").fill(DEMO_PASSWORD);
  await page.getByLabel("Type it again").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Create my account" }).click();
  await expect(page.getByText("Your account is ready")).toBeVisible();
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^Good to see you/ })).toBeVisible();

  // The link worked once.
  await page.goto(new URL(link).pathname);
  await expect(page.getByText("This link has already been used.")).toBeVisible();

  // Their own password.
  await page.goto("/account/security");
  const password = page.getByRole("region", { name: "Password" });
  await password.getByLabel("Current password").fill(DEMO_PASSWORD);
  await password.getByLabel("New password").fill(NEW_PASSWORD);
  await password.getByLabel("Type it again").fill(NEW_PASSWORD);
  await password.getByRole("button", { name: "Change password" }).click();
  await expect(password.getByText(/Password changed/)).toBeVisible();

  // The owner disables the account.
  await page.context().clearCookies();
  await signIn(page, DEMO.owner);
  await page.goto("/admin/users");
  await page.getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await page.getByRole("button", { name: "Disable account" }).click();
  await expect(page.getByText("Account disabled and signed out everywhere")).toBeVisible();

  await page.context().clearCookies();
  await enterPassword(page, email, NEW_PASSWORD);
  await expect(page.getByRole("heading", { level: 1, name: /^Good to see you/ })).toBeHidden();
  await expect(page).toHaveURL(/\/sign-in/);
});
