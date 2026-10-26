import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers/session";

test("the executive dashboard shows defined figures, and money only with sensitive access", async ({
  page,
}) => {
  await signIn(page, DEMO.owner);
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Reports" })
    .click();
  await page.getByRole("link", { name: "Executive" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Executive" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sales pipeline" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Invoiced revenue" })).toBeVisible();
  await expect(page.getByText("Demo data", { exact: true })).toBeVisible();

  // Every figure carries its definition.
  const pipeline = page.locator("details").filter({ hasText: "Open opportunities" });
  await pipeline.locator("summary").first().click();
  await expect(pipeline.getByText("Source: CRM opportunities and pipeline stages")).toBeVisible();

  await page.getByRole("link", { name: "Definitions" }).click();
  await expect(page.getByRole("heading", { name: "Production dashboard" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Contracted revenue", exact: true })).toBeVisible();
});

test("without sensitive reports the dashboard says why money is missing", async ({ page }) => {
  await signIn(page, DEMO.sales);
  await page.goto("/reports/executive");
  await expect(page.getByRole("heading", { level: 1, name: "Executive" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active projects" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Invoiced revenue" })).toHaveCount(0);
  await expect(
    page.getByText("Money figures need access to sensitive reports.").first(),
  ).toBeVisible();
});

test("the project manager and production dashboards open for people who run projects", async ({
  page,
}) => {
  await signIn(page, DEMO.owner);
  await page.goto("/reports/projects?scope=all");
  await expect(page.getByRole("heading", { level: 1, name: "Project manager" })).toBeVisible();
  await expect(page.getByText("Crew:").first()).toBeVisible();
  await page.getByRole("link", { name: "Production", exact: true }).last().click();
  await expect(page.getByRole("heading", { level: 1, name: "Production" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent changes" })).toBeVisible();

  // Show crew work at the venue; they have no reports.
  await page.context().clearCookies();
  await signIn(page, DEMO.showCrew);
  await page.goto("/reports/production");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
