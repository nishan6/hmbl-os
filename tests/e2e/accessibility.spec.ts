import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { DEMO, enterPassword, signIn } from "./helpers/session";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectNoViolations(page: Page) {
  // Next.js streams a page's <title> in after its content; let the stream
  // finish so axe checks the whole document rather than racing it.
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveTitle(/\S/);
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
      test.setTimeout(150_000);
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
        "/crew",
        "/crew/new",
        "/finance",
        "/finance/accounts",
        "/finance/journals",
        "/finance/journals/new",
        "/finance/invoices",
        "/finance/invoices/new",
        "/finance/credit-notes",
        "/finance/receipts",
        "/finance/receipts/new",
        "/finance/receivables",
        "/finance/bills",
        "/finance/bills/new",
        "/finance/payments",
        "/finance/payments/new",
        "/finance/payables",
        "/finance/expense-claims",
        "/finance/advances",
        "/finance/advances/new",
        "/finance/staff-balances",
        "/expenses",
        "/expenses/new",
        "/finance/vendors",
        "/finance/vendors/new",
        "/finance/bank-accounts",
        "/finance/trial-balance",
        "/finance/reports",
        "/finance/reports/profit-and-loss",
        "/finance/reports/balance-sheet",
        "/finance/reports/cash-flow",
        "/finance/reports/tax",
        "/finance/reports/projects",
        "/finance/periods",
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
      for (const [list, link] of [
        ["/finance/expense-claims", /^EXP\//],
        ["/finance/advances", /^ADV\//],
      ] as const) {
        await test.step(`one of ${list}`, async () => {
          await page.goto(list);
          await page.getByRole("combobox", { name: "Books of" }).selectOption({ label: "DEMO-IN" });
          await page.getByRole("button", { name: "Show" }).first().click();
          await page.getByRole("link", { name: link }).first().click();
          await expect(
            page.getByRole("heading", { level: 1, name: /^(Claim|Advance) / }),
          ).toBeVisible();
          await expectNoViolations(page);
        });
      }
      await test.step("a crew member", async () => {
        await page.goto("/crew");
        await page.getByRole("link", { name: "Demo Ravi Lights (DEMO)" }).click();
        await expect(
          page.getByRole("heading", { level: 1, name: "Demo Ravi Lights (DEMO)" }),
        ).toBeVisible();
        await expectNoViolations(page);
      });
      await test.step("a period's close checklist", async () => {
        await page.goto("/finance/periods");
        await page.getByRole("combobox", { name: "Books of" }).selectOption({ label: "DEMO-IN" });
        await page.getByRole("button", { name: "Show" }).first().click();
        await page.getByRole("link", { name: "Oct 2026" }).click();
        await expect(
          page.getByRole("heading", { level: 2, name: "Close checklist" }),
        ).toBeVisible();
        await expectNoViolations(page);
      });
      await test.step("a number format", async () => {
        await page.goto("/admin/numbering");
        await page.getByRole("link", { name: "Sales invoice" }).first().click();
        await expect(page.getByRole("heading", { level: 2, name: "Counts" })).toBeVisible();
        await expectNoViolations(page);
      });
      await test.step("a bank reconciliation", async () => {
        await page.goto("/finance/bank-accounts");
        await page.getByRole("combobox", { name: "Books of" }).selectOption({ label: "DEMO-IN" });
        await page.getByRole("button", { name: "Show" }).first().click();
        await page
          .getByRole("link", { name: /^Reconcile / })
          .first()
          .click();
        await expect(page.getByRole("heading", { level: 1, name: /^Reconcile / })).toBeVisible();
        await expectNoViolations(page);
      });
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
      await test.step("an invoice, its editor and its print view", async () => {
        await page.goto("/finance/invoices");
        await page.getByRole("combobox", { name: "Books of" }).selectOption({ label: "DEMO-IN" });
        await page.getByRole("button", { name: "Show" }).click();
        await page.getByRole("link", { name: "Draft" }).first().click();
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoViolations(page);
        const invoiceUrl = page.url();
        await page.goto(`${invoiceUrl}/edit`);
        await expect(
          page.getByRole("heading", { level: 1, name: /^Draft tax invoice/ }),
        ).toBeVisible();
        await expectNoViolations(page);
        await page.goto(invoiceUrl.replace("/finance/invoices/", "/print/invoices/"));
        await expect(page.getByRole("heading", { level: 1, name: "Tax invoice" })).toBeVisible();
        await expectNoViolations(page);
      });
      await test.step("a bill awaiting approval and a vendor", async () => {
        await page.goto("/finance/bills");
        await page.getByRole("combobox", { name: "Books of" }).selectOption({ label: "DEMO-IN" });
        await page.getByRole("button", { name: "Show" }).click();
        await page.getByRole("link", { name: "To approve" }).first().click();
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expectNoViolations(page);
        await page.getByRole("link", { name: "Demo Lights and Rigging (DEMO)" }).click();
        await expect(page.getByRole("heading", { level: 2, name: "Bills" })).toBeVisible();
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
