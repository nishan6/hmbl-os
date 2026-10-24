import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers/session";

test("a truck is planned, booked, dispatched and delivered", async ({ page }) => {
  const stamp = Date.now().toString(36).toUpperCase();
  await signIn(page, DEMO.owner);
  await page.goto("/logistics/shipments/new");
  const project = page.getByRole("combobox", { name: /^Project/ });
  const option = project.locator("option", { hasText: "P-2627-0001" });
  await project.selectOption({ value: (await option.getAttribute("value"))! });
  await page.getByRole("textbox", { name: /^Title/ }).fill(`E2E truck ${stamp}`);
  await page.getByLabel("Carrier", { exact: true }).fill("E2E Roadways");
  await page.getByLabel(/^From/).fill("Warehouse, Guwahati");
  await page.getByLabel(/^To \*?$/).fill("Venue, Shillong");
  await page.getByLabel(/^Pick-up/).fill("2099-05-01T06:00");
  await page.getByLabel(/^Cost/).fill("12000");
  await page.getByLabel(/^Paid from budget line/).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Plan movement" }).click();
  await page.waitForURL(/\/logistics\/shipments\/[^/]+$/);
  await expect(page.getByText(/1 May 2099, 6:00.*am IST/i)).toBeVisible();

  await page.getByRole("button", { name: "Mark booked" }).click();
  await expect(page.getByText("Booked").first()).toBeVisible();
  await page.getByRole("button", { name: "Mark dispatched" }).click();
  await expect(page.getByText("In transit").first()).toBeVisible();
  await page.getByLabel(/^Received by/).fill("Venue manager");
  await page.getByRole("button", { name: "Mark delivered" }).click();
  await expect(page.getByText(/received by Venue manager/)).toBeVisible();
});
