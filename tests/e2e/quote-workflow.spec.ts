import { expect, test, type Page } from "@playwright/test";
import { DEMO, signIn } from "./helpers/session";

/** Starts a quote from a demo opportunity with one fixed-price line, and saves it. */
async function draftQuote(page: Page, opportunity: string, price: string) {
  await page.goto("/crm");
  await page.getByRole("link", { name: opportunity }).first().click();
  await page.getByRole("link", { name: "New quote" }).click();
  await page.getByRole("button", { name: "Create and add lines" }).click();
  await page.getByRole("button", { name: "Add line" }).click();
  const line = page.getByRole("group", { name: "Line 1" });
  await line.getByRole("textbox", { name: "Description" }).fill("Production package");
  await line.getByRole("combobox", { name: "Pricing" }).selectOption("FIXED");
  await line.getByRole("textbox", { name: "Price" }).fill(price);
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved")).toBeVisible();
  return page.url();
}

async function setApproval(page: Page, entity: string, on: boolean) {
  await page.goto("/admin/master-data");
  const panel = page.getByRole("region", { name: "Quote rules" }).locator("div", {
    has: page.getByRole("heading", { name: new RegExp(`^${entity}`) }),
  });
  const box = panel.getByRole("checkbox", { name: /Director's approval/ }).first();
  await box.setChecked(on);
  await panel.getByRole("button", { name: "Save" }).first().click();
  await expect(panel.getByText("Quote rules saved").first()).toBeVisible();
}

test("sales issues a quote, prints it, then revises it", async ({ page }) => {
  await signIn(page, DEMO.sales);
  await draftQuote(page, "Pixel league finals broadcast (DEMO)", "250000");
  const next = page.getByRole("region", { name: "Next step" });
  await next.getByRole("button", { name: "Mark as issued" }).click();
  await expect(page.getByText("Issued. This version is now locked")).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit draft" })).toHaveCount(0);

  const [doc] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("link", { name: "Print or PDF" }).click(),
  ]);
  await expect(doc.getByRole("heading", { name: "Quotation" })).toBeVisible();
  await expect(doc.getByText("₹2,95,000.00").first()).toBeVisible();
  await expect(doc.getByText(/margin|cost/i)).toHaveCount(0);
  await doc.close();

  await next.getByRole("button", { name: "Create a revision" }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^Edit Q-/ })).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Version 2")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Versions" }).getByText("Superseded"),
  ).toBeVisible();
});

test("with approval on, the Director approves before sales can issue", async ({ browser }) => {
  const director = await browser.newPage();
  await signIn(director, DEMO.owner);
  await setApproval(director, "DEMO-AE", true);

  const sales = await browser.newPage();
  await signIn(sales, DEMO.sales);
  const url = await draftQuote(sales, "Gulf studio refit consult (DEMO)", "40000");
  const next = sales.getByRole("region", { name: "Next step" });
  await expect(next.getByRole("button", { name: "Mark as issued" })).toHaveCount(0);
  await next.getByLabel("Note for the approver").fill("New client, standard rates");
  await next.getByRole("button", { name: "Submit for approval" }).click();
  await expect(sales.getByText("Waiting for the Director's approval")).toBeVisible();

  // This quote, not another left waiting by an earlier run.
  const number = (await sales.getByRole("heading", { level: 1 }).innerText()).split(" · ")[0]!;
  await director.goto("/");
  await director
    .getByRole("region", { name: "Quotes waiting for your approval" })
    .getByRole("link", { name: new RegExp(number) })
    .click();
  const decision = director.getByRole("region", { name: "Next step" });
  await decision.getByRole("button", { name: "Send back to draft" }).click();
  await expect(decision.getByText("Required", { exact: true })).toBeVisible();
  await decision.getByLabel("Comment").fill("Fine as it is");
  await decision.getByRole("button", { name: "Approve" }).click();
  await expect(director.getByText("Approved. It can be issued now")).toBeVisible();
  const history = director.getByRole("region", { name: "Approval history" });
  await expect(history.getByText("New client, standard rates")).toBeVisible();

  await sales.goto(url.replace(/\?.*$/, ""));
  await sales
    .getByRole("region", { name: "Next step" })
    .getByRole("button", { name: "Mark as issued" })
    .click();
  await expect(sales.getByText("Issued. This version is now locked")).toBeVisible();

  await setApproval(director, "DEMO-AE", false);
});
