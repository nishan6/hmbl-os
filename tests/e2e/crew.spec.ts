import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers/session";

test("a freelancer is added with a skill, a rate and time off", async ({ page }) => {
  const name = `E2E Follow Spot ${Date.now().toString(36)}`;
  await signIn(page, DEMO.owner);
  await page.goto("/crew");
  await page.getByRole("link", { name: "New crew member" }).click();
  await page.getByRole("textbox", { name: /^Name/ }).fill(name);
  await page.getByLabel("Roles and skills").fill("Follow spot, Rigging");
  await page.getByLabel("Based in").fill("Shillong");
  await page.getByRole("button", { name: "Add crew member" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  const rates = page.getByRole("region", { name: "Rates" });
  await rates.getByLabel("Amount").fill("4500");
  await rates.getByLabel("From").fill("2026-01-01");
  await rates.getByRole("button", { name: "Add rate" }).click();
  await expect(rates.getByRole("row", { name: /Any role/ })).toContainText("₹4,500.00");

  const off = page.getByRole("region", { name: "Time off" });
  await off.getByLabel("From").fill("2099-05-01");
  await off.getByLabel("Reason").fill("Leave");
  await off.getByRole("button", { name: "Add time off" }).click();
  await expect(off.getByRole("row", { name: /Leave/ })).toBeVisible();

  await page.goto("/crew?skill=Follow+spot");
  await expect(page.getByRole("link", { name })).toBeVisible();
});
