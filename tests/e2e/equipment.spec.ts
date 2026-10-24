import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers/session";

test("an asset with a fault only returns to service once the job is done", async ({ page }) => {
  const stamp = Date.now().toString(36).toUpperCase();
  const name = `E2E Profile ${stamp}`;
  await signIn(page, DEMO.owner);
  await page.goto("/equipment/new");
  await page.getByRole("textbox", { name: /^Name/ }).fill(name);
  await page.getByRole("textbox", { name: /^SKU/ }).fill(`E2E-${stamp}`);
  await page.getByLabel("Category").selectOption({ label: "Lighting (DEMO)" });
  await page.getByLabel("Rental per day").fill("2500");
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  const assets = page.getByRole("region", { name: "Assets" });
  await assets.getByRole("textbox", { name: /^Asset tag/ }).fill(`E2E-${stamp}-1`);
  await assets.getByRole("button", { name: "Add asset" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: new RegExp(`E2E-${stamp}-1`) }),
  ).toBeVisible();

  // A new asset in an inspected category is due an inspection: do it first.
  const jobs = page.getByRole("region", { name: "Maintenance" });
  await jobs.getByLabel("Kind").selectOption({ label: "Inspection" });
  await jobs.getByRole("textbox", { name: "What", exact: true }).fill("First inspection");
  await jobs.getByRole("button", { name: "Open job" }).click();
  await jobs.getByRole("checkbox", { name: "Safety bond fitted" }).check();
  await jobs.getByRole("checkbox", { name: "Clamp and bolt secure" }).check();
  await jobs.getByRole("checkbox", { name: "Lens clean" }).check();
  await jobs.getByRole("textbox", { name: /^What was found/ }).fill("All fine");
  await jobs.getByRole("button", { name: "Mark done" }).click();
  await expect(jobs.getByText("Passed: Lens clean")).toBeVisible();

  await jobs.getByLabel("Kind").selectOption({ label: "Fault" });
  await jobs.getByRole("textbox", { name: "What", exact: true }).fill("Gobo wheel stuck");
  await jobs.getByRole("button", { name: "Open job" }).click();
  const back = page.getByRole("region", { name: "Return to service" });
  await expect(back.getByText("1 maintenance job is still open")).toBeVisible();

  await jobs.getByRole("textbox", { name: /^What was found/ }).fill("Freed the gobo wheel");
  await jobs.getByRole("button", { name: "Mark done" }).click();
  await back.getByRole("button", { name: "Return to service" }).click();
  await expect(page.getByRole("region", { name: "Return to service" })).toHaveCount(0);
  await expect(page.getByText("Available").first()).toBeVisible();
});
