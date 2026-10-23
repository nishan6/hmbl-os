import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers/session";

test("sales captures an enquiry, logs a follow-up and loses it with a reason", async ({ page }) => {
  const title = `E2E enquiry ${Date.now().toString(36)}`;
  await signIn(page, DEMO.sales);
  await page.goto("/crm");
  await expect(page.getByRole("heading", { level: 2, name: /Proposal sent/ })).toBeVisible();

  await page.getByRole("link", { name: "New opportunity" }).click();
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(title);
  await page
    .getByRole("combobox", { name: "Client", exact: true })
    .selectOption({ label: "Demo Arena Live (DEMO)" });
  await page
    .getByRole("combobox", { name: "Contact", exact: true })
    .selectOption({ label: "Demo Priya Shah" });
  await page
    .getByRole("combobox", { name: "HMBL entity" })
    .selectOption({ label: "DEMO-IN · Demo Live Productions Private Limited" });
  await page.getByLabel("Expected value").fill("lots");
  await page.getByRole("button", { name: "Create opportunity" }).click();
  await expect(page.getByText("Enter an amount")).toBeVisible();
  await page.getByLabel("Expected value").fill("8,00,000");
  await page.getByRole("button", { name: "Create opportunity" }).click();

  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.getByText("₹8,00,000.00")).toBeVisible();

  const activity = page.getByRole("region", { name: "Activity" });
  await activity.getByLabel("Type").selectOption("FOLLOW_UP");
  await activity.getByLabel("Subject").fill("Send rider and stage plot");
  await activity.getByLabel("Due").fill("2030-01-10T10:00");
  await activity.getByRole("button", { name: "Add activity" }).click();
  await expect(activity.getByText("Send rider and stage plot")).toBeVisible();
  await activity.getByRole("button", { name: "Done" }).click();
  await expect(activity.getByText("Completed")).toBeVisible();

  const stage = page.getByRole("region", { name: "Stage" });
  await stage.getByLabel("Move to").selectOption({ label: "Lost" });
  await stage.getByRole("button", { name: "Move" }).click();
  await expect(stage.getByText("Give a reason for this outcome")).toBeVisible();
  await stage.getByLabel("Reason").fill("Client picked a cheaper vendor");
  await stage.getByRole("button", { name: "Move" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Client picked a cheaper vendor" }),
  ).toBeVisible();

  await page.goto("/crm");
  await expect(
    page.getByRole("region", { name: "On hold and closed" }).getByRole("link", { name: title }),
  ).toBeVisible();
});
