import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers/session";

test("sales creates a client past a duplicate warning and adds a contact", async ({ page }) => {
  const suffix = Date.now().toString(36);
  await signIn(page, DEMO.sales);
  await page.goto("/crm/clients");
  await expect(page.getByRole("link", { name: "Demo Arena Live (DEMO)" })).toBeVisible();

  await page.getByRole("link", { name: "New client" }).click();
  // Same name as the demo client once "(DEMO)" punctuation and case are ignored.
  await page.getByRole("textbox", { name: "Name", exact: true }).fill("DEMO ARENA LIVE demo");
  await page.getByRole("button", { name: "Create client" }).click();
  await expect(page.getByText("Possible duplicate")).toBeVisible();

  await page.getByRole("textbox", { name: "Name", exact: true }).fill(`E2E Client ${suffix}`);
  await page.getByLabel("Tax ID type").fill("GSTIN");
  await page.getByRole("textbox", { name: "Tax ID", exact: true }).fill("12345");
  await page.getByRole("button", { name: "Create client" }).click();
  await expect(page.getByText("A GSTIN has 15 characters")).toBeVisible();
  await page.getByLabel("Tax ID type").fill("");
  await page.getByRole("textbox", { name: "Tax ID", exact: true }).fill("");
  await page.getByRole("button", { name: "Create client" }).click();

  await expect(page.getByRole("heading", { level: 1, name: `E2E Client ${suffix}` })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Client created" })).toBeVisible();

  await page.getByLabel("Contact name").fill("Asha Rao");
  await page.getByLabel("Contact email").fill("asha@e2e.example");
  await page.getByRole("button", { name: "Add contact" }).click();
  const contacts = page.getByRole("region", { name: "Contacts" });
  await expect(contacts.getByRole("row", { name: /Asha Rao.*Primary/ })).toBeVisible();
});

test("a viewer sees clients but cannot add them", async ({ page }) => {
  await signIn(page, DEMO.viewer);
  await page.goto("/crm/clients");
  await expect(page.getByRole("heading", { level: 1, name: "Clients" })).toBeVisible();
  await expect(page.getByRole("link", { name: "New client" })).toHaveCount(0);
  await page.goto("/crm/clients/new");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
