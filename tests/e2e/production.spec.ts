import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers/session";

const openDemoShow = async (page: import("@playwright/test").Page) => {
  await page.goto("/production");
  await page
    .getByRole("link", { name: /New Year gala/ })
    .first()
    .click();
  await page.waitForURL(/\/production\/[^/?]+/);
};

test("whoever plans the show keeps its running order", async ({ page }) => {
  const stamp = Date.now().toString(36).toUpperCase();
  await signIn(page, DEMO.owner);
  await openDemoShow(page);
  // The demo running order is on the first show day, after the build days.
  await page
    .getByRole("navigation", { name: "Show days" })
    .getByRole("link", { name: "31 Dec 2026" })
    .click();
  await expect(page.getByRole("heading", { name: "Running order for 31 Dec 2026" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Sound check" })).toBeVisible();

  await page.getByRole("link", { name: "Run of show", exact: true }).click();
  await page.getByLabel(/^Time/).first().fill("2215");
  await page
    .getByLabel(/^What happens/)
    .first()
    .fill(`E2E encore ${stamp}`);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByRole("cell", { name: new RegExp(`E2E encore ${stamp}`) })).toBeVisible();
  await expect(page.getByRole("cell", { name: "22:15" })).toBeVisible();
});

test("the venue crew see the show day and post what is happening", async ({ page }) => {
  const stamp = Date.now().toString(36).toUpperCase();
  await signIn(page, DEMO.showCrew);
  await openDemoShow(page);
  await expect(page.getByRole("heading", { name: "Crew calls" })).toBeVisible();
  // The venue crew can't plan the show or see its costs.
  await expect(page.getByRole("link", { name: "Edit the run of show" })).toHaveCount(0);
  await expect(page.getByText(/₹/)).toHaveCount(0);

  await page.getByLabel(/^Status/).selectOption("DELAYED");
  await page.getByLabel(/^Update/).fill(`E2E doors held ${stamp}`);
  await page.getByRole("button", { name: "Post update" }).click();
  await expect(page.getByText(`E2E doors held ${stamp}`).first()).toBeVisible();

  await page.getByLabel(/^Note/).fill(`E2E stage door code ${stamp}`);
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(page.getByText(`E2E stage door code ${stamp}`)).toBeVisible();

  await page.getByRole("link", { name: "Notes and log" }).click();
  await expect(
    page.getByRole("cell", { name: new RegExp(`E2E doors held ${stamp}`) }),
  ).toBeVisible();
});
