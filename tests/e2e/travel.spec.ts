import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers/session";

test("a trip is planned, approved and its train confirmed", async ({ page }) => {
  const stamp = Date.now().toString(36).toUpperCase();
  await signIn(page, DEMO.owner);
  await page.goto("/logistics/travel/new");
  const project = page.getByRole("combobox", { name: /^Project/ });
  const option = project.locator("option", { hasText: "P-2627-0001" });
  await project.selectOption({ value: (await option.getAttribute("value"))! });
  await page.getByRole("textbox", { name: /^Purpose/ }).fill(`E2E recce ${stamp}`);
  await page.getByLabel(/^First day/).fill("2099-05-01");
  await page.getByLabel("Last day").fill("2099-05-02");
  await page.getByLabel(/^Estimate/).fill("9000");
  await page.getByLabel(/^Paid from budget line/).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Start trip" }).click();
  await page.waitForURL(/\/logistics\/travel\/[^/]+$/);

  await page.getByText("Add a traveller").click();
  await page.getByRole("textbox", { name: /^Name/ }).fill(`E2E scout ${stamp}`);
  await page.getByRole("button", { name: "Add traveller" }).click();
  await expect(page.getByRole("cell", { name: new RegExp(`^E2E scout ${stamp}`) })).toBeVisible();

  await page.getByRole("link", { name: "Train", exact: true }).click();
  await page.getByLabel("Rail operator").fill("Indian Railways");
  await page.getByLabel("Booking reference").fill(`PNR${stamp}`);
  await page.getByLabel(/^From/).fill("Guwahati");
  await page.getByLabel(/^To/).fill("Dibrugarh");
  await page.getByLabel(/^Leaves/).fill("2099-05-01T21:40");
  await page.getByLabel(/^Cost/).fill("2400");
  await page.getByRole("button", { name: "Hold booking" }).click();
  await page.waitForURL(/\/logistics\/travel\/[^/]+$/);
  await expect(page.getByText(/1 May 2099, 9:40.*pm IST/i)).toBeVisible();

  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("Pending approval").first()).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText(/^TRV\//).first()).toBeVisible();
  await page.getByRole("button", { name: /^Confirm/ }).click();
  await expect(page.getByText("Confirmed").first()).toBeVisible();
});
