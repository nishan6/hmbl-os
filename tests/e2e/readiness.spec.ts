import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers/session";

test("an owner runs the readiness checks and keeps the run as evidence", async ({ page }) => {
  await signIn(page, DEMO.owner);
  await page.goto("/");
  await page.getByRole("navigation").getByRole("link", { name: "Readiness" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Readiness" })).toBeVisible();

  const runs = page.getByRole("region", { name: "Earlier runs" }).getByRole("table");
  const before = (await runs.isVisible()) ? await runs.getByRole("row").count() : 1;
  await page.getByRole("button", { name: "Run checks now" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /Latest run, .* by .*owner@demo\.hmbl\.test/ }),
  ).toBeVisible();
  await expect(runs.getByRole("row")).toHaveCount(before + 1);

  const journals = page.getByRole("listitem").filter({ hasText: "Posted journals balance" });
  await expect(journals.getByText("Pass", { exact: true })).toBeVisible();
  // The demo database is not the live one, and says so.
  await expect(page.getByText(/This is not the live database/)).toBeVisible();
  const demo = page.getByRole("listitem").filter({ hasText: "No demo data in the live database" });
  await expect(demo.getByText(/demo records .* are expected/)).toBeVisible();
});

test("people who don't manage the organisation can't see readiness", async ({ page }) => {
  await signIn(page, DEMO.sales);
  await page.goto("/");
  await expect(page.getByRole("navigation").getByRole("link", { name: "Readiness" })).toHaveCount(
    0,
  );
  await page.goto("/admin/readiness");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
});
