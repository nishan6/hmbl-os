import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers/session";

test("sales records the client's acceptance and the project is created", async ({ page }) => {
  const title = `E2E concert ${Date.now().toString(36)}`;
  await signIn(page, DEMO.sales);
  await page.goto("/crm/opportunities/new");
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(title);
  await page
    .getByRole("combobox", { name: "Client", exact: true })
    .selectOption({ label: "Demo Arena Live (DEMO)" });
  await page
    .getByRole("combobox", { name: "HMBL entity" })
    .selectOption({ label: "DEMO-IN · Demo Live Productions Private Limited" });
  await page.getByRole("button", { name: "Create opportunity" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  const opportunityUrl = page.url();
  await page.getByRole("link", { name: "New quote" }).click();
  await page.getByRole("button", { name: "Create and add lines" }).click();
  await page.getByRole("button", { name: "Add line" }).click();
  const line = page.getByRole("group", { name: "Line 1" });
  await line.getByRole("textbox", { name: "Description" }).fill("Concert production");
  await line.getByRole("combobox", { name: "Pricing" }).selectOption("FIXED");
  await line.getByRole("textbox", { name: "Price" }).fill("500000");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Draft saved")).toBeVisible();

  const next = page.getByRole("region", { name: "Next step" });
  await next.getByRole("button", { name: "Mark as issued" }).click();
  await expect(page.getByText("Issued. This version is now locked")).toBeVisible();

  await next.getByRole("button", { name: "Record acceptance and create project" }).click();
  await expect(next.getByText("The acceptance wasn't recorded")).toBeVisible();
  await next.getByLabel("Accepted by").fill("Meera Iyer");
  await next.getByLabel("How").selectOption({ label: "Email" });
  await next.getByRole("button", { name: "Record acceptance and create project" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: new RegExp(`^P-.* ${title}$`) }),
  ).toBeVisible();
  await expect(page.getByText("Quote accepted and project created")).toBeVisible();
  // ₹5,00,000 + GST 18%, split 50/50 by the default payment terms.
  const figures = page.getByRole("region", { name: "Figures" });
  await expect(figures.getByText("₹5,00,000.00")).toBeVisible();
  await expect(figures.getByText("₹5,90,000.00")).toBeVisible();
  const milestones = page.getByRole("region", { name: "Billing milestones" });
  await expect(milestones.getByText("₹2,95,000.00")).toHaveCount(2);
  await expect(page.getByText("Meera Iyer")).toBeVisible();

  await page.getByRole("link", { name: /^Q-.* v1$/ }).click();
  await expect(page.getByText("Accepted by Meera Iyer")).toBeVisible();
  await expect(page.getByRole("region", { name: "Next step" })).toHaveCount(0);

  await page.goto(opportunityUrl);
  await expect(page.getByText(/Quote Q-.* accepted/).first()).toBeVisible();
  await expect(page.getByRole("region", { name: "Projects" }).getByText(title)).toBeVisible();

  await page.goto("/projects");
  await expect(page.getByRole("cell", { name: title })).toBeVisible();
});
