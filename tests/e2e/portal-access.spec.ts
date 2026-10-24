import { expect, test } from "@playwright/test";
import { DEMO, DEMO_PASSWORD, enterPassword, signIn } from "./helpers/session";

test("a client contact is invited, creates their account and sees only the portal", async ({
  page,
}) => {
  const stamp = Date.now().toString(36);
  const email = `guest.${stamp}@pixel.demo.test`;
  await signIn(page, DEMO.sales);
  await page.goto("/crm/clients");
  await page.getByRole("link", { name: "Demo Pixel Esports League (DEMO)" }).click();
  const access = page.getByRole("region", { name: "Portal access" });
  await access
    .getByLabel("Contact")
    .selectOption({ label: "Demo Neha Iyer (neha@pixel.demo.test)" });
  await access.getByLabel("Name").fill("Neha Iyer");
  await access.getByLabel("Email").fill(email);
  await access.getByRole("button", { name: "Create invitation" }).click();
  const link = await access.getByLabel("Invitation link").inputValue();
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
  await expect(access.getByRole("row", { name: new RegExp(email) })).toContainText("Invited");

  // The invitee, in a fresh browser.
  await page.context().clearCookies();
  await page.goto(new URL(link).pathname);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Demo Sales invited you to the HMBL portal",
  );
  await page.getByLabel("Your email address").fill("wrong@pixel.demo.test");
  await page.getByLabel("Choose a password").fill(DEMO_PASSWORD);
  await page.getByLabel("Type it again").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Create my account" }).click();
  await expect(
    page.getByText("That isn't the address this invitation was sent for."),
  ).toBeVisible();
  await page.getByLabel("Your email address").fill(email);
  await page.getByLabel("Choose a password").fill(DEMO_PASSWORD);
  await page.getByLabel("Type it again").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Create my account" }).click();
  await expect(page.getByText("Your portal account is ready")).toBeVisible();

  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Welcome, Neha Iyer" })).toBeVisible();
  await expect(page.getByRole("banner")).toContainText("Demo Pixel Esports League (DEMO)");

  // HMBL OS itself is closed to portal accounts.
  for (const path of ["/", "/crm/clients", "/finance", "/admin/users"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/portal$/);
  }
  expect(
    (await page.request.get("/api/documents/00000000-0000-0000-0000-000000000000")).status(),
  ).toBe(401);

  // The link works once.
  await page.goto(new URL(link).pathname);
  await expect(page.getByText("This invitation has already been used.")).toBeVisible();
});

test("staff are sent back to HMBL OS from the portal", async ({ page }) => {
  await signIn(page, DEMO.viewer);
  await page.goto("/portal");
  await expect(page.getByRole("heading", { level: 1, name: /^Good to see you/ })).toBeVisible();
});

test("the demo vendor signs in to the portal", async ({ page }) => {
  await enterPassword(page, "vendor@demo.hmbl.test");
  await expect(page.getByRole("heading", { level: 1, name: /^Welcome, / })).toBeVisible();
  await expect(page.getByText("See purchase orders issued to them")).toBeVisible();
});
