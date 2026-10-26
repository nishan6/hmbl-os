import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers/session";

test("opening balances check every file and stay unposted until the totals agree", async ({
  page,
}) => {
  await signIn(page, DEMO.owner);
  await page.goto("/finance");
  await page.getByRole("link", { name: "Opening balances" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Opening balances" })).toBeVisible();

  await page.getByLabel("Cut-over date").fill("2020-03-31");
  await page.getByRole("textbox", { name: "Old system" }).fill("Tally Prime");
  await page.getByLabel("Trial balance total debits").fill("100000");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reconciliation" })).toBeVisible();

  // A file with a problem saves nothing and says which line is wrong.
  const trialBalance = page.locator("form").filter({ hasText: "Trial balance" }).last();
  await trialBalance.getByLabel("Trial balance").setInputFiles({
    name: "tb.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Account code,Debit,Credit\r\n1000,100000,\r\n1200,5000,\r\n"),
  });
  await trialBalance.getByRole("button", { name: "Check and save" }).click();
  await expect(trialBalance.getByText(/Line 3: 1200 Trade receivables comes from/)).toBeVisible();

  await trialBalance.getByLabel("Trial balance").setInputFiles({
    name: "tb.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Account code,Debit,Credit\r\n1000,100000,\r\n"),
  });
  await trialBalance.getByRole("button", { name: "Check and save" }).click();
  await expect(trialBalance.getByText("1 row saved, replacing the earlier file")).toBeVisible();

  // Unbalanced and missing figures keep it from posting.
  await expect(page.getByText("Not ready to post")).toBeVisible();
  await expect(page.getByText(/Debits and credits differ by/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Post opening balances" })).toHaveCount(0);
});
