import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers/session";

test("finance posts a manual journal and sees it in the trial balance", async ({ page }) => {
  const narration = `E2E accrual ${Date.now().toString(36)}`;
  await signIn(page, DEMO.owner);
  await page.goto("/finance/accounts");
  await page.getByRole("combobox", { name: "Books of" }).selectOption({ label: "DEMO-IN" });
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page.getByRole("link", { name: "Trade receivables" })).toBeVisible();

  await page.getByRole("link", { name: "Journals" }).click();
  await page.getByRole("link", { name: "New journal" }).click();
  await page.getByRole("textbox", { name: "Narration" }).fill(narration);
  await page.getByLabel("Line 1 account").selectOption({ label: "6040 · Professional fees" });
  await page.getByLabel("Line 1 debit").fill("15,000");
  await page.getByLabel("Line 2 account").selectOption({ label: "2900 · Suspense" });
  await page.getByLabel("Line 2 credit").fill("14000");
  await expect(page.getByText("Out of balance by ₹1,000.00")).toBeVisible();
  await page.getByLabel("Line 2 credit").fill("15000");
  await page.getByRole("button", { name: "Save draft" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Draft journal" })).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Post" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^Journal JV\// })).toBeVisible();

  await page
    .getByRole("navigation", { name: "Breadcrumb" })
    .getByRole("link", { name: "Finance" })
    .click();
  await page.getByRole("link", { name: "Trial balance" }).click();
  await expect(page.getByRole("link", { name: "Professional fees" })).toBeVisible();
  await expect(page.getByRole("row", { name: /Totals/ })).toBeVisible();
});
