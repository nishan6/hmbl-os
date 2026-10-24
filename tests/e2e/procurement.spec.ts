import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers/session";

test("an order is approved, partly received and billed from what arrived", async ({ page }) => {
  const stamp = Date.now().toString(36).toUpperCase();
  const item = `E2E cable ties ${stamp}`;
  await signIn(page, DEMO.owner);
  await page.goto("/procurement/new");
  const chooser = page.getByRole("link", { name: /^DEMO-IN/ });
  if (await chooser.isVisible()) await chooser.click();
  await page
    .getByRole("combobox", { name: /^Vendor/ })
    .selectOption({ label: "Demo Lights and Rigging (DEMO) (INR)" });
  await page
    .getByRole("combobox", { name: /^What is being bought/ })
    .selectOption({ label: "Consumables" });
  const project = page.getByRole("combobox", { name: /^Project/ });
  const option = project.locator("option", { hasText: "P-2627-0001" });
  await project.selectOption({ value: (await option.getAttribute("value"))! });
  await page.getByRole("button", { name: "Start order" }).click();
  await page.waitForURL(/\/procurement\/[^/]+\/edit$/);

  await page.getByLabel("Line 1 description").fill(item);
  await page.getByLabel("Line 1 quantity").fill("10");
  await page.getByLabel("Line 1 rate").fill("300");
  await page.getByLabel("Line 1 budget line").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Save order" }).click();
  await page.waitForURL(/\/procurement\/[^/]+$/);

  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("Pending approval").first()).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^PO\// })).toBeVisible();

  const receipt = page.getByRole("region", { name: "Record a receipt" });
  await receipt.getByRole("textbox", { name: new RegExp(item) }).fill("4");
  await receipt.getByRole("button", { name: "Record receipt" }).click();
  await expect(
    page.getByRole("region", { name: "Receipts" }).getByText(`4 × ${item}`),
  ).toBeVisible();

  await page.getByRole("button", { name: "Draft the bill" }).click();
  await page.waitForURL(/\/finance\/bills\/[^/]+\/edit$/);
  await expect(page.getByLabel("Line 1 quantity")).toHaveValue("4");
});
