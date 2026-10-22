import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers/session";

test("an owner creates a legal entity, fixing a validation error on the way", async ({ page }) => {
  // Unique per run, because e2e runs share a database with the seed.
  const code = `E2E-${Date.now().toString(36).toUpperCase()}`;
  await signIn(page, DEMO.owner);

  await page.goto("/admin/organisation");
  await expect(
    page
      .getByRole("region", { name: "Legal entities" })
      .getByRole("cell", { name: "DEMO-IN", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "New legal entity" }).click();

  await page.getByRole("textbox", { name: "Code", exact: true }).fill(code);
  await page.getByLabel("Legal name").fill("End-to-end Test Entity Pvt Ltd");
  await page.getByLabel("Base currency").fill("XX");
  await page.getByRole("button", { name: "Create legal entity" }).click();

  await expect(page.getByText("The entity wasn't created")).toBeVisible();
  await expect(page.getByLabel("Base currency")).toHaveAttribute("aria-invalid", "true");
  // What the user typed is still there.
  await expect(page.getByLabel("Legal name")).toHaveValue("End-to-end Test Entity Pvt Ltd");
  await expect(page.getByRole("textbox", { name: "Code", exact: true })).toHaveValue(code);

  await page.getByLabel("Base currency").fill("INR");
  await page.getByRole("button", { name: "Create legal entity" }).click();

  await expect(page).toHaveURL(/\/admin\/organisation\/entities\/[\w-]+\?created=1$/);
  await expect(page.getByRole("status").filter({ hasText: "Legal entity created" })).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 1, name: "End-to-end Test Entity Pvt Ltd" }),
  ).toBeVisible();

  await page.goto("/admin/audit");
  await expect(page.getByText("legal_entity.created").first()).toBeVisible();
});

test("a sales user can view the organisation but not create entities", async ({ page }) => {
  await signIn(page, DEMO.sales);
  await page.goto("/admin/organisation");
  await expect(page.getByRole("heading", { level: 1, name: "Organisation" })).toBeVisible();
  await expect(page.getByRole("link", { name: "New legal entity" })).toHaveCount(0);

  await page.goto("/admin/organisation/entities/new");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
