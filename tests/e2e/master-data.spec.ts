import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers/session";

test("an owner adds a payment term, fixing an instalment total on the way", async ({ page }) => {
  const code = `E2E${Date.now().toString(36).toUpperCase()}`.slice(0, 20);
  await signIn(page, DEMO.owner);
  await page.goto("/admin/master-data");

  const taxes = page.getByRole("region", { name: "Tax rates" });
  await expect(taxes.getByRole("row", { name: /GST18.*Default.*18%/ })).toBeVisible();

  const terms = page.getByRole("region", { name: "Payment terms" });
  await terms.getByRole("textbox", { name: "Code", exact: true }).fill(code);
  await terms
    .getByRole("textbox", { name: "Name", exact: true })
    .fill("30% advance, 60% on delivery");
  await terms.getByLabel("Instalment 1 label").fill("Advance");
  await terms.getByRole("textbox", { name: "Percent" }).first().fill("30");
  await terms.getByRole("textbox", { name: "Percent" }).nth(1).fill("60");
  await terms.getByRole("button", { name: "Add payment term" }).click();
  await expect(terms.getByText("Instalments must add up to 100%")).toBeVisible();

  await terms.getByRole("textbox", { name: "Percent" }).nth(1).fill("70");
  await terms.getByRole("button", { name: "Add payment term" }).click();
  await expect(terms.getByRole("cell", { name: code, exact: true })).toBeVisible();
});

test("a sales user sees master data but can't change it", async ({ page }) => {
  await signIn(page, DEMO.sales);
  await page.goto("/admin/master-data");
  await expect(page.getByRole("heading", { level: 1, name: "Master data" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add tax rate" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add payment term" })).toHaveCount(0);
});
