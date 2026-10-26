import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers/session";

test("the integrations page says honestly what works", async ({ page }) => {
  await signIn(page, DEMO.owner);
  await page.goto("/");
  await page.getByRole("navigation").getByRole("link", { name: "Integrations" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Integrations" })).toBeVisible();
  const email = page.getByRole("listitem").filter({ hasText: "Email notifications" });
  await expect(email.getByText("Not set up")).toBeVisible();
  await expect(email.getByText(/no email is sent/)).toBeVisible();
  const gmail = page.getByRole("listitem").filter({ hasText: "Gmail" });
  await expect(gmail.getByText("Not connected").first()).toBeVisible();
});

test("a calendar link serves the feed until it is replaced or turned off", async ({
  page,
  playwright,
}) => {
  const anonymous = await playwright.request.newContext({
    baseURL: test.info().project.use.baseURL,
  });
  await signIn(page, DEMO.owner);
  await page.goto("/account/calendar");
  await expect(page.getByRole("heading", { level: 1, name: "Calendar feed" })).toBeVisible();
  page.on("dialog", (d) => d.accept());
  // A link left by an earlier run is turned off first.
  if (await page.getByRole("button", { name: "Turn off" }).isVisible()) {
    await page.getByRole("button", { name: "Turn off" }).click();
    await expect(page.getByRole("button", { name: "Make my calendar link" })).toBeVisible();
  }

  await page.getByRole("button", { name: "Make my calendar link" }).click();
  const first = new URL(await page.getByRole("textbox", { name: "Calendar link" }).inputValue())
    .pathname;
  const feed = await anonymous.get(first);
  expect(feed.status()).toBe(200);
  expect(feed.headers()["content-type"]).toContain("text/calendar");
  expect(await feed.text()).toContain("BEGIN:VCALENDAR");

  await page.getByRole("button", { name: "Make a new link" }).click();
  await expect(page.getByRole("textbox", { name: "Calendar link" })).not.toHaveValue(
    new RegExp(first.slice(-20)),
  );
  expect((await anonymous.get(first)).status()).toBe(404);
  const second = new URL(await page.getByRole("textbox", { name: "Calendar link" }).inputValue())
    .pathname;

  await page.getByRole("button", { name: "Turn off" }).click();
  await expect(page.getByRole("button", { name: "Make my calendar link" })).toBeVisible();
  expect((await anonymous.get(second)).status()).toBe(404);
  await anonymous.dispose();
});

test("the day book lists posted journals and downloads as CSV", async ({ page }) => {
  await signIn(page, DEMO.owner);
  await page.goto("/finance/reports");
  await page.getByRole("main").getByRole("link", { name: "Day book" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Day book" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download CSV" }).click();
  expect((await download).suggestedFilename()).toMatch(
    /_day-book_\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv$/,
  );
});
