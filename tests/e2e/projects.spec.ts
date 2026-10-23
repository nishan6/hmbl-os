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
