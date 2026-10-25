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
  const row = page.getByRole("row", { name: new RegExp(`E2E encore ${stamp}`) });
  await expect(row.getByRole("cell", { name: "22:15" })).toBeVisible();
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

test("checklists are ticked at the venue and incidents reported", async ({ browser }) => {
  const stamp = Date.now().toString(36).toUpperCase();
  const planner = await browser.newPage();
  await signIn(planner, DEMO.owner);
  await openDemoShow(planner);
  await planner.getByRole("link", { name: "Checklists", exact: true }).first().click();
  const form = planner.getByRole("region", { name: "New checklist" });
  await form.getByLabel(/^Title/).fill(`E2E pre-show ${stamp}`);
  await form.getByLabel("Start from").selectOption("PRE_SHOW");
  await form.getByLabel("Items", { exact: true }).fill(`Confetti cannons armed ${stamp}`);
  await form.getByRole("button", { name: "Create checklist" }).click();
  await expect(planner.getByRole("heading", { name: `E2E pre-show ${stamp}` })).toBeVisible();
  const showUrl = planner.url();

  const crew = await browser.newPage();
  await signIn(crew, DEMO.showCrew);
  await crew.goto(showUrl);
  const section = crew.getByRole("region", { name: `E2E pre-show ${stamp}` });
  await section.getByRole("button", { name: `Tick Confetti cannons armed ${stamp}` }).click();
  await expect(
    section.getByRole("button", { name: `Untick Confetti cannons armed ${stamp}` }),
  ).toBeVisible();
  await expect(section.getByText("1 of 7 done", { exact: false })).toBeVisible();

  await crew.getByRole("link", { name: "Incidents", exact: true }).click();
  const report = crew.getByRole("region", { name: "Report an incident" });
  await report.getByLabel(/^Kind/).selectOption("TECHNICAL");
  await report.getByLabel(/^Severity/).selectOption("LOW");
  await report.getByLabel(/^Title/).fill(`E2E dimmer trip ${stamp}`);
  await report.getByLabel(/^What happened/).fill("Dimmer rack 2 tripped during focus.");
  await report.getByRole("button", { name: "Report incident" }).click();
  await expect(
    crew.getByRole("region", { name: "Incidents" }).getByText(`E2E dimmer trip ${stamp}`),
  ).toBeVisible();
  // Resolving is for planners.
  await expect(crew.getByText("Resolve", { exact: true })).toHaveCount(0);
});
