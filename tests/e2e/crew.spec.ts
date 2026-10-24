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

test("a crew member is booked on a project, confirmed and their day approved", async ({ page }) => {
  const name = `E2E Stagehand ${Date.now().toString(36)}`;
  await signIn(page, DEMO.owner);
  await page.goto("/crew/new");
  await page.getByRole("textbox", { name: /^Name/ }).fill(name);
  await page.getByLabel("Roles and skills").fill("Stagehand");
  await page.getByRole("button", { name: "Add crew member" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  await page.goto("/projects");
  await page
    .getByRole("row", { name: /New Year gala/ })
    .getByRole("link", { name: /^P-/ })
    .click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  await page.goto(`${page.url()}/resources`);
  const bookings = page.getByRole("region", { name: "Crew bookings" });
  await bookings.getByLabel("Crew member").selectOption({ label: `${name} (Stagehand)` });
  await bookings.getByLabel("Booked as").fill("Stagehand");
  await bookings.getByLabel("First day").fill("2098-03-02");
  await bookings.getByLabel("Last day").fill("2098-03-03");
  await bookings.getByRole("button", { name: "Propose" }).click();
  const row = bookings.getByRole("row", { name: new RegExp(name) });
  await expect(row).toContainText("Proposed");
  await row.getByRole("button", { name: "Confirm" }).click();
  await expect(row).toContainText("Confirmed");

  await row.getByRole("link", { name }).click();
  const days = page.getByRole("region", { name: "Days worked" });
  await days.getByLabel("Overtime (hours)").fill("1:30");
  await days.getByRole("button", { name: "Record day" }).click();
  await expect(days.getByRole("row", { name: /1 h 30 min/ })).toBeVisible();
  await days.getByRole("button", { name: /^Approve/ }).click();
  await expect(days.getByRole("row", { name: /1 h 30 min/ })).toContainText("Approved");

  await page.goto(`/crew`);
  await page.getByRole("link", { name }).click();
  await expect(
    page.getByRole("region", { name: "Bookings" }).getByRole("row", { name: /Stagehand/ }),
  ).toContainText("Confirmed");
});
