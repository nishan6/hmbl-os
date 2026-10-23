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

test("finance issues a GST invoice, credits part of it and prints both", async ({ page }) => {
  const line = `E2E LED wall ${Date.now().toString(36)}`;
  await signIn(page, DEMO.owner);
  await page.goto("/finance/invoices");
  await page.getByRole("combobox", { name: "Books of" }).selectOption({ label: "DEMO-IN" });
  await page.getByRole("button", { name: "Show" }).click();
  await page.getByRole("link", { name: "New invoice" }).click();
  await page
    .getByRole("combobox", { name: "Client" })
    .selectOption({ label: "Demo Arena Live (DEMO)" });
  await page.getByRole("button", { name: "Start invoice" }).click();

  // DEMO-IN and the client are both in Maharashtra: CGST and SGST.
  await expect(page.getByRole("heading", { level: 1, name: /^Draft invoice to/ })).toBeVisible();
  await expect(page.getByText("Within the state (CGST + SGST)")).toBeVisible();
  await page.getByLabel("Line 1 description").fill(line);
  await page.getByLabel("Line 1 rate").fill("50,000");
  await expect(page.getByText("₹59,000.00")).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();

  await expect(page.getByRole("cell", { name: line })).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Issue" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^Invoice INV\// })).toBeVisible();
  const invoiceUrl = page.url();

  await page.getByRole("link", { name: "Tax invoice" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Tax invoice" })).toBeVisible();
  await expect(page.getByText("Rupees Fifty Nine Thousand Only")).toBeVisible();
  await expect(page.getByText("Maharashtra (27)")).toBeVisible();

  await page.goto(invoiceUrl);
  await page.getByRole("link", { name: "Credit note" }).click();
  await page.getByRole("textbox", { name: "Reason" }).fill("Half a day cancelled");
  await page.getByLabel(`Credit on ${line}`).fill("10000");
  await expect(page.getByText("₹11,800.00")).toBeVisible();
  await page.getByRole("button", { name: "Save draft credit note" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Draft credit note" })).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Issue" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^Credit note CN\// })).toBeVisible();
  await page.getByRole("link", { name: "Credit note document" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Credit note" })).toBeVisible();
  await expect(page.getByText("Rupees Eleven Thousand Eight Hundred Only")).toBeVisible();

  await page.goto(invoiceUrl);
  await expect(page.getByRole("definition").filter({ hasText: "₹47,200.00" })).toBeVisible();
});
