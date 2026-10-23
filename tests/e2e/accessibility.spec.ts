import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { DEMO, enterPassword, signIn } from "./helpers/session";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(
    violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test("sign-in meets WCAG 2.2 AA", async ({ page }) => {
      await page.goto("/sign-in");
      await expectNoViolations(page);
    });

    test("the two-factor code step meets WCAG 2.2 AA", async ({ page }) => {
      await enterPassword(page, DEMO.owner);
      await expect(page.getByLabel("6-digit code")).toBeVisible();
      await expectNoViolations(page);
    });

    test("the required two-factor setup meets WCAG 2.2 AA", async ({ page }) => {
      await enterPassword(page, DEMO.newFinance);
      await expect(page.getByRole("heading", { name: "Set up two-factor sign-in" })).toBeVisible();
      await expectNoViolations(page);
    });

    test("app pages meet WCAG 2.2 AA", async ({ page }) => {
      await signIn(page, DEMO.owner);
      for (const path of [
        "/",
        "/admin/organisation",
        "/admin/organisation/entities/new",
        "/crm",
        "/crm/opportunities/new",
        "/crm/clients",
        "/crm/clients/new",
        "/quotes",
        "/quotes/new",
        "/admin/master-data",
        "/admin/numbering",
        "/admin/users",
        "/admin/audit",
        "/account/security",
      ]) {
        await test.step(path, async () => {
          await page.goto(path);
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          await expectNoViolations(page);
        });
      }
      await test.step("a quote and its editor", async () => {
        await page.goto("/quotes");
        await page
          .getByRole("row", { name: /Draft/ })
          .getByRole("link", { name: /^Q-/ })
          .first()
          .click();
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoViolations(page);
        const quoteUrl = page.url();
        await page.goto(quoteUrl.replace("/quotes/", "/print/quotes/"));
        await expect(page.getByRole("heading", { level: 1, name: "Quotation" })).toBeVisible();
        await expectNoViolations(page);
        await page.goto(quoteUrl);
        await page.getByRole("link", { name: "Edit draft" }).click();
        await expect(page.getByRole("heading", { level: 1, name: /^Edit/ })).toBeVisible();
        await expectNoViolations(page);
      });
    });
  });
}
