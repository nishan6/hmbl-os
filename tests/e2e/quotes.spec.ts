import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers/session";

test("sales prices a quote from an opportunity, with live totals and server checks", async ({
  page,
}) => {
  await signIn(page, DEMO.sales);
  await page.goto("/crm");
  await page.getByRole("link", { name: "Arena product launch (DEMO)" }).first().click();
  await page.getByRole("link", { name: "New quote" }).click();
  await expect(page.getByRole("textbox", { name: "Title" })).toHaveValue(
    "Arena product launch (DEMO)",
  );
  await page.getByRole("button", { name: "Create and add lines" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^Edit Q-/ })).toBeVisible();

  await page.getByRole("button", { name: "Add line" }).click();
  const first = page.getByRole("group", { name: "Line 1" });
  await first.getByRole("textbox", { name: "Description" }).fill("Stage hands");
  await first.getByRole("textbox", { name: "Qty" }).fill("4");
  await first.getByRole("textbox", { name: "Days" }).fill("2");
  await first.getByRole("textbox", { name: "Unit cost" }).fill("3000");
  await first.getByRole("textbox", { name: "Rate" }).fill("5000");
  await expect(first.getByText("₹40,000.00")).toBeVisible();
  await expect(first.getByText("40% margin")).toBeVisible();

  await page.getByRole("button", { name: "Add line" }).click();
  const second = page.getByRole("group", { name: "Line 2" });
  await second.getByRole("textbox", { name: "Description" }).fill("LED wall");
  await second.getByRole("combobox", { name: "Pricing" }).selectOption("COST_PLUS_MARGIN");
  await second.getByRole("textbox", { name: "Unit cost" }).fill("75000");
  await second.getByRole("textbox", { name: "Margin %" }).fill("100");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Check line 2.")).toBeVisible();
  await expect(second.getByText(/Must be between 0% and 99.99%/)).toBeVisible();

  await second.getByRole("textbox", { name: "Margin %" }).fill("25");
  const totals = page.getByRole("heading", { name: "Totals" }).locator("..");
  await expect(totals.getByText("₹1,65,200.00")).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();

  await expect(page.getByText("Draft saved")).toBeVisible();
  await expect(
    page.getByRole("row", { name: /LED wall/ }).getByRole("cell", { name: "₹1,00,000.00" }),
  ).toHaveCount(2);
  await expect(
    page.getByRole("region", { name: "Totals" }).getByText("₹1,65,200.00"),
  ).toBeVisible();
});

test("people who can only view a quote don't see its costs", async ({ page }) => {
  await signIn(page, DEMO.projectManager);
  await page.goto("/quotes");
  await page.getByRole("link", { name: /^Q-/ }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Cost" })).toHaveCount(0);
  await expect(page.getByText("Gross margin")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Edit draft" })).toHaveCount(0);
});
