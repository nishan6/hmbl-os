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

test("finance records a receipt with TDS that settles an invoice", async ({ page }) => {
  const line = `E2E crew ${Date.now().toString(36)}`;
  await signIn(page, DEMO.owner);
  await page.goto("/finance/invoices");
  await page.getByRole("combobox", { name: "Books of" }).selectOption({ label: "DEMO-IN" });
  await page.getByRole("button", { name: "Show" }).click();
  await page.getByRole("link", { name: "New invoice" }).click();
  await page
    .getByRole("combobox", { name: "Client" })
    .selectOption({ label: "Demo Arena Live (DEMO)" });
  await page.getByRole("button", { name: "Start invoice" }).click();
  await page.getByLabel("Line 1 description").fill(line);
  await page.getByLabel("Line 1 rate").fill("10000");
  await page.getByRole("button", { name: "Save draft" }).click();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Issue" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^Invoice INV\// })).toBeVisible();
  const invoiceUrl = page.url();

  await page.getByRole("link", { name: "Record receipt" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Record a receipt" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /Amount received/ })).toHaveValue("11800.00");
  await page.getByRole("textbox", { name: /Amount received/ }).fill("10800");
  await page.getByRole("textbox", { name: "TDS deducted" }).fill("1000");
  await page.getByRole("combobox", { name: "TDS section" }).fill("194J");
  await page.getByRole("textbox", { name: "Reference" }).fill("UTR-E2E");
  await expect(page.getByText("On account ₹0.00")).toBeVisible();
  await page.getByRole("button", { name: "Record receipt" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^Receipt RCT\// })).toBeVisible();
  await expect(page.getByText("₹1,000.00 u/s 194J")).toBeVisible();

  await page.goto(invoiceUrl);
  await expect(page.getByText("Paid", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /^RCT\// })).toBeVisible();

  await page.goto("/finance/receivables");
  await page.getByRole("combobox", { name: "Books of" }).selectOption({ label: "DEMO-IN" });
  await page.getByRole("button", { name: "Show" }).first().click();
  await expect(page.getByText(/Agrees with the receivables account/)).toBeVisible();
});

test("finance enters a bill with TDS, approves it and pays it", async ({ page }) => {
  const invoiceNumber = `E2E/${Date.now().toString(36)}`;
  await signIn(page, DEMO.owner);
  await page.goto("/finance/bills");
  await page.getByRole("combobox", { name: "Books of" }).selectOption({ label: "DEMO-IN" });
  await page.getByRole("button", { name: "Show" }).click();
  await page.getByRole("link", { name: "Enter a bill" }).click();
  await page
    .getByRole("combobox", { name: "Vendor" })
    .selectOption({ label: "Demo Lights and Rigging (DEMO) (INR)" });
  await page.getByRole("button", { name: "Start bill" }).click();
  await page.getByRole("textbox", { name: "Their invoice number" }).fill(invoiceNumber);
  await expect(page.getByRole("textbox", { name: "TDS rate (%)" })).toHaveValue("2");
  await page.getByLabel("Line 1 description").fill("E2E truss hire");
  await page.getByLabel("Line 1 rate").fill("10000");
  await page.getByLabel("Line 1 account").selectOption({ label: "5010 · Equipment hire" });
  await expect(page.getByRole("definition").filter({ hasText: "₹11,600.00" })).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();

  await expect(page.getByRole("heading", { level: 1, name: /^Draft bill from/ })).toBeVisible();
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect(page.getByText("Awaiting approval")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^Bill VB\// })).toBeVisible();
  await expect(page.getByText("₹200.00 u/s 194C")).toBeVisible();

  await page.getByRole("link", { name: "Record payment" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Record a payment" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /Amount paid/ })).toHaveValue("11600.00");
  await expect(page.getByText("Advance ₹0.00")).toBeVisible();
  await page.getByRole("button", { name: "Record payment" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^Payment PAY\// })).toBeVisible();

  await page.goto("/finance/payables");
  await page.getByRole("combobox", { name: "Books of" }).selectOption({ label: "DEMO-IN" });
  await page.getByRole("button", { name: "Show" }).first().click();
  await expect(page.getByText(/Agrees with trade payables/)).toBeVisible();
});

test("staff claim an expense with a receipt, and Finance approves and reimburses it", async ({
  browser,
}) => {
  const title = `E2E recce ${Date.now().toString(36)}`;
  const sales = await browser.newPage();
  await signIn(sales, DEMO.sales);
  await sales
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Expenses" })
    .click();
  await sales.getByRole("link", { name: "New claim" }).click();
  await sales.getByRole("textbox", { name: "What it was for" }).fill(title);
  const company = sales.getByRole("combobox", { name: "Company" });
  const india = await company.locator("option", { hasText: "DEMO-IN" }).getAttribute("value");
  await company.selectOption(india!);
  await sales.getByRole("button", { name: "Start claim" }).click();

  await sales.getByLabel("Expense 1 category").selectOption({ label: "Meals" });
  await sales.getByLabel("Expense 1 description").fill("E2E crew lunch");
  await sales.getByLabel("Expense 1 amount in INR").fill("1600");
  await expect(sales.getByText(/Over the ₹1,500.00 limit for Meals/)).toBeVisible();
  await sales.getByLabel("Expense 1 reason for the exception").fill("Lunch for four crew");
  await expect(sales.getByRole("definition").filter({ hasText: "₹1,600.00" })).toBeVisible();
  await sales.getByRole("button", { name: "Save draft" }).click();

  await expect(sales.getByRole("heading", { level: 1, name: "Draft claim" })).toBeVisible();
  const upload = sales.getByRole("region", { name: "Attach a receipt" });
  await upload.getByLabel("Receipt").setInputFiles({
    name: "lunch.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 receipt"),
  });
  await upload.getByRole("button", { name: "Attach receipt" }).click();
  await expect(upload.getByText("Attached lunch.pdf")).toBeVisible();
  await expect(sales.getByRole("link", { name: "lunch.pdf" })).toBeVisible();
  await sales.getByRole("button", { name: "Submit for approval" }).click();
  await expect(sales.getByRole("heading", { level: 1, name: /^Claim EXP\// })).toBeVisible();
  // Nobody approves their own claim.
  await expect(sales.getByRole("button", { name: "Approve" })).toHaveCount(0);
  const claimUrl = sales.url();

  const owner = await browser.newPage();
  await signIn(owner, DEMO.owner);
  await owner.goto(claimUrl);
  owner.once("dialog", (d) => d.accept());
  await owner.getByRole("button", { name: "Approve" }).click();
  await expect(owner.getByText("Claim journal")).toBeVisible();
  const settle = owner.getByRole("region", { name: "Settle" });
  await settle
    .getByRole("combobox", { name: "Settle from" })
    .selectOption({ label: "1010 · Petty cash" });
  await expect(settle.getByRole("textbox", { name: /Amount/ })).toHaveValue("1600.00");
  await settle.getByRole("button", { name: "Settle" }).click();
  await expect(owner.getByText("Paid from 1010 · Petty cash")).toBeVisible();

  await owner.goto("/finance/staff-balances");
  await owner.getByRole("combobox", { name: "Books of" }).selectOption({ label: "DEMO-IN" });
  await owner.getByRole("button", { name: "Show" }).first().click();
  await expect(owner.getByText(/Agrees with advances to staff/)).toBeVisible();
  await expect(owner.getByText(/Agrees with reimbursements payable/)).toBeVisible();
});
