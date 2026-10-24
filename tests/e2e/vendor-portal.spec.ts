import { expect, test } from "@playwright/test";
import { enterPassword } from "./helpers/session";

test("the demo vendor reads an approved order and uploads an invoice", async ({ page }) => {
  await enterPassword(page, "vendor@demo.hmbl.test");
  await expect(page.getByRole("heading", { level: 1, name: /^Welcome, / })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Portal" });
  await nav.getByRole("link", { name: "Purchase orders" }).click();
  await page.getByRole("link", { name: /^PO\// }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: /^Purchase order PO\// })).toBeVisible();
  await expect(page.getByRole("region", { name: "Lines" })).toBeVisible();

  const stamp = Date.now().toString(36).toUpperCase();
  const upload = page.getByRole("region", { name: "Upload your invoice" });
  await upload.getByLabel("Your invoice number").fill(`INV-${stamp}`);
  await upload.getByLabel("Invoice date").fill("2026-10-20");
  await upload.getByLabel(/^Total with tax/).fill("1180");
  await upload.getByLabel("Invoice file").setInputFiles({
    name: `inv-${stamp}.pdf`,
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 demo invoice"),
  });
  await upload.getByRole("button", { name: "Upload invoice" }).click();
  await expect(upload.getByText(`Uploaded invoice INV-${stamp}`)).toBeVisible();
  await expect(page.getByRole("region", { name: "Invoices you uploaded" })).toContainText(
    `INV-${stamp}`,
  );

  await nav.getByRole("link", { name: "Bills and payments" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Bills and payments" })).toBeVisible();

  // Nothing internal is reachable.
  await page.goto("/procurement");
  await expect(page).toHaveURL(/\/portal$/);
  await page.goto("/portal/bookings");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
});

test("the demo freelancer sees their bookings and records a day", async ({ page }) => {
  await enterPassword(page, "freelancer@demo.hmbl.test");
  const nav = page.getByRole("navigation", { name: "Portal" });
  await nav.getByRole("link", { name: "Bookings" }).click();
  await expect(page.getByRole("link", { name: "Rigging (DEMO)" })).toBeVisible();
  await page.getByRole("link", { name: "Lighting operator (DEMO)" }).click();
  await expect(page.getByText("14:00")).toBeVisible();

  const record = page.getByRole("region", { name: "Record a day" });
  const min = await record.getByLabel("Date").getAttribute("min");
  await record.getByLabel("Date").fill(min!);
  await record.getByLabel("Overtime hours").fill("1.5");
  await record.getByRole("button", { name: "Save day" }).click();
  await expect(record.getByText("Day saved. HMBL will approve it.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Days recorded" })).toContainText("1.5 h");

  await nav.getByRole("link", { name: "Your details" }).click();
  await expect(page.getByLabel("Where you are based")).toHaveValue("Mumbai");
  await nav.getByRole("link", { name: "Pay" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Pay" })).toBeVisible();
});
