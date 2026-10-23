import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers/session";

test("a direct project is approved, put on hold and edited", async ({ page }) => {
  const name = `E2E warehouse move ${Date.now().toString(36)}`;
  await signIn(page, DEMO.owner);
  await page.goto("/projects");
  await page.getByRole("link", { name: "New project" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await page
    .getByRole("combobox", { name: "HMBL entity" })
    .selectOption({ label: "DEMO-IN · Demo Live Productions Private Limited" });
  await page
    .getByRole("combobox", { name: "Project type" })
    .selectOption({ label: "Internal project" });
  await expect(page.getByRole("combobox", { name: "Revenue model" })).toHaveValue("INTERNAL");
  await page
    .getByRole("combobox", { name: "Project manager" })
    .selectOption({ label: "Demo Project Manager" });
  await page.getByRole("button", { name: "Create project" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: new RegExp(`^P-.* ${name}$`) }),
  ).toBeVisible();
  const lifecycle = page.getByRole("region", { name: "Lifecycle" });
  await expect(page.getByRole("main").getByText("Draft").first()).toBeVisible();
  await lifecycle.getByLabel("Move to").selectOption({ label: "Approved" });
  await lifecycle.getByRole("button", { name: "Change status" }).click();
  await expect(lifecycle.getByText("Status changed")).toBeVisible();

  await lifecycle.getByLabel("Move to").selectOption({ label: "On hold" });
  await lifecycle.getByRole("button", { name: "Change status" }).click();
  await expect(lifecycle.getByText("The status wasn't changed")).toBeVisible();
  await lifecycle.getByLabel("Reason").fill("Waiting for the lease");
  await lifecycle.getByRole("button", { name: "Change status" }).click();
  const history = page.getByRole("region", { name: "Status history" });
  await expect(history.getByText("Waiting for the lease")).toBeVisible();

  await page.getByRole("link", { name: "Edit details" }).click();
  await page.getByRole("textbox", { name: "Venue or city" }).fill("Bhiwandi warehouse");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Project details saved")).toBeVisible();
  await expect(page.getByText("Bhiwandi warehouse")).toBeVisible();
  await expect(page.getByText("Demo Project Manager")).toBeVisible();

  await page.goto("/projects?status=ON_HOLD");
  await expect(page.getByRole("cell", { name })).toBeVisible();
});

test("a project manager tracks committed and actual costs against the budget", async ({ page }) => {
  const ref = `PO-${Date.now().toString(36)}`;
  await signIn(page, DEMO.owner);
  await page.goto("/projects");
  await page.getByRole("link", { name: /^P-/ }).last().click();
  await page.getByRole("link", { name: "Budget", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Budget lines" })).toBeVisible();

  const form = page.getByRole("region", { name: "Committed and actual costs" });
  await form.getByLabel("Budget line").selectOption({ label: "Crew · Show crew" });
  await form.getByLabel("Amount").fill("40000");
  await form.getByLabel("Description").fill("Crew booking");
  await form.getByLabel("Reference").fill(ref);
  await form.getByRole("button", { name: "Record cost" }).click();
  await expect(form.getByText("Cost recorded")).toBeVisible();

  await form.getByLabel("Budget line").selectOption({ label: "Crew · Show crew" });
  await form.getByLabel("Type").selectOption("ACTUAL");
  await form.getByLabel("Amount").fill("40000");
  await form.getByLabel("Description").fill("Crew invoice");
  await form
    .getByLabel("Against commitment")
    .selectOption({ label: `${ref} · Crew booking (₹40,000.00)` });
  await form.getByRole("button", { name: "Record cost" }).click();
  await expect(form.getByText("Cost recorded")).toBeVisible();
  await expect(form.getByRole("cell", { name: new RegExp(`Against ${ref}`) })).toBeVisible();
});
