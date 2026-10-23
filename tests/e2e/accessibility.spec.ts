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
      // Many pages, each scanned by axe.
      test.setTimeout(90_000);
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
        "/projects",
        "/projects/new",
        "/finance",
        "/finance/accounts",
        "/finance/journals",
        "/finance/journals/new",
        "/finance/trial-balance",
        "/finance/settings",
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
      await test.step("a project", async () => {
        await page.goto("/projects");
        await page.getByRole("link", { name: /^P-/ }).first().click();
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoViolations(page);
        const projectUrl = page.url();
        await page.getByRole("link", { name: "Edit details" }).click();
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoViolations(page);
        await page.goto(`${projectUrl}/budget`);
        await expect(page.getByRole("heading", { level: 2, name: "Budget lines" })).toBeVisible();
        await expectNoViolations(page);
        await page.goto(`${projectUrl}/schedule`);
        await expect(page.getByRole("heading", { level: 2, name: "Schedule" })).toBeVisible();
        await expectNoViolations(page);
        await page.goto(`${projectUrl}/resources`);
        await expect(page.getByRole("heading", { level: 2, name: "Crew plan" })).toBeVisible();
        await expectNoViolations(page);
        await page.goto(`${projectUrl}/documents`);
        await expect(page.getByRole("heading", { level: 2, name: "Documents" })).toBeVisible();
        await expectNoViolations(page);
        await page.goto(`${projectUrl}/closeout`);
        await expect(
          page.getByRole("heading", { level: 2, name: "Closeout checklist" }),
        ).toBeVisible();
        await expectNoViolations(page);
        await page.goto(`${projectUrl}/changes`);
        await expect(page.getByRole("heading", { level: 2, name: "Change orders" })).toBeVisible();
        await expectNoViolations(page);
        // The demo project has a draft change order.
        await page.goto("/projects");
        await page
          .getByRole("row", { name: /New Year gala/ })
          .getByRole("link", { name: /^P-/ })
          .click();
        await page.getByRole("link", { name: "Change orders", exact: true }).click();
        await page.getByRole("link", { name: /^CO-01/ }).click();
        await expect(page.getByRole("heading", { level: 2, name: "Budget changes" })).toBeVisible();
        await expectNoViolations(page);
      });
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
