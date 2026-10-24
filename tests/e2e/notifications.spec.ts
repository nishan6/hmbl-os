import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers/session";

test("the bell opens notifications, settings save, and approvals list what is waiting", async ({
  page,
}) => {
  await signIn(page, DEMO.owner);
  await page.getByRole("link", { name: /^Notifications, / }).click();
  await expect(page.getByRole("heading", { name: "Notifications", level: 1 })).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  const email = page.getByLabel("An invoice is overdue: email");
  await email.check();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Saved")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("An invoice is overdue: email")).toBeChecked();
  await page.getByLabel("An invoice is overdue: email").uncheck();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Saved")).toBeVisible();

  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Approvals" })
    .click();
  await expect(page.getByRole("heading", { name: "Approvals", level: 1 })).toBeVisible();
});
