import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { DEMO, signIn } from "./helpers/session";

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

    test("app pages meet WCAG 2.2 AA", async ({ page }) => {
      await signIn(page, DEMO.owner);
      for (const path of [
        "/",
        "/admin/organisation",
        "/admin/organisation/entities/new",
        "/admin/numbering",
        "/admin/users",
        "/admin/audit",
      ]) {
        await test.step(path, async () => {
          await page.goto(path);
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          await expectNoViolations(page);
        });
      }
    });
  });
}
