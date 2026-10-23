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

test("a change order is agreed with the client and approved into a new budget version", async ({
  page,
}) => {
  const title = `E2E extra truss ${Date.now().toString(36)}`;
  await signIn(page, DEMO.owner);
  await page.goto("/projects");
  await page.getByRole("link", { name: /^P-/ }).last().click();
  await page.getByRole("link", { name: "Change orders", exact: true }).click();
  await page.getByRole("textbox", { name: "Title" }).fill(title);
  await page.getByRole("textbox", { name: "Reason" }).fill("More rigging points");
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByRole("heading", { level: 2, name: new RegExp(title) })).toBeVisible();

  const changes = page.getByRole("region", { name: "Budget changes" });
  await changes.getByLabel("Budget line").selectOption({ label: "Crew · Show crew" });
  await changes.getByLabel("Cost change").fill("6000");
  await changes.getByLabel("Revenue change").fill("9000");
  await changes.getByRole("button", { name: "Add change" }).click();
  await expect(changes.getByText("Change saved")).toBeVisible();
  await expect(page.getByText("Client agreement needed")).toBeVisible();

  const client = page.getByRole("region", { name: "Client agreement" });
  await client.getByLabel("Agreed on").fill("2026-10-20");
  await client.getByLabel("Agreed by").fill("Priya Shah");
  await client.getByLabel("How").selectOption({ label: "Email" });
  await client.getByRole("button", { name: "Record client agreement" }).click();
  await expect(client.getByText("Client agreement recorded")).toBeVisible();

  await page.getByRole("button", { name: "Approve change" }).click();
  await expect(page.getByRole("main").getByText("Approved").first()).toBeVisible();

  await page.getByRole("link", { name: "Change orders" }).first().click();
  const versions = page.getByRole("region", { name: "Budget versions" });
  await expect(versions.getByRole("link", { name: new RegExp(title) })).toBeVisible();
});

test("the schedule is planned and a milestone ticked off", async ({ page }) => {
  const title = `E2E rigging plot ${Date.now().toString(36)}`;
  await signIn(page, DEMO.owner);
  await page.goto("/projects");
  await page
    .getByRole("row", { name: /New Year gala/ })
    .getByRole("link", { name: /^P-/ })
    .click();
  await page.getByRole("link", { name: "Schedule", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Billing milestones" })).toBeVisible();

  const schedule = page.getByRole("region", { name: "Schedule" });
  // The add form comes after the edit forms of each row.
  const form = schedule.locator("form").last();
  await form.getByLabel("What").selectOption({ label: "Milestone" });
  await form.getByLabel("Title").fill(title);
  await form.getByLabel("Due").fill("2026-12-15");
  await form.getByRole("button", { name: "Add to schedule" }).click();
  await expect(form.getByText("Schedule saved")).toBeVisible();

  const row = schedule.getByRole("row", { name: new RegExp(title) });
  await row.getByRole("button", { name: `Mark done ${title}` }).click();
  await expect(row.getByText("Completed")).toBeVisible();
});

test("a crew role is planned against its budget line", async ({ page }) => {
  const role = `E2E follow spot op ${Date.now().toString(36)}`;
  await signIn(page, DEMO.owner);
  await page.goto("/projects");
  await page
    .getByRole("row", { name: /New Year gala/ })
    .getByRole("link", { name: /^P-/ })
    .click();
  await page.getByRole("link", { name: "Crew and equipment", exact: true }).click();

  const crew = page.getByRole("region", { name: "Crew plan" });
  const form = crew.locator("form").last();
  await form.getByLabel("Role").fill(role);
  await form.getByLabel("How many").fill("2");
  await form.getByLabel("From").fill("2026-12-31");
  await form.getByLabel("To").fill("2027-01-01");
  await form.getByLabel("Budget line").selectOption({ label: "Crew · Show crew" });
  await form.getByLabel("Day rate").fill("3000");
  await form.getByRole("button", { name: "Add to plan" }).click();
  await expect(form.getByText("Plan saved")).toBeVisible();
  await expect(crew.getByRole("row", { name: new RegExp(role) })).toContainText("₹12,000.00");

  const check = page.getByRole("region", { name: "Plan against budget" });
  await expect(check.getByRole("row", { name: /Show crew/ })).toContainText("Over by");
});

test("a large document is uploaded and downloaded", async ({ page }) => {
  const title = `E2E LED content ${Date.now().toString(36)}`;
  await signIn(page, DEMO.owner);
  await page.goto("/projects");
  await page
    .getByRole("row", { name: /New Year gala/ })
    .getByRole("link", { name: /^P-/ })
    .click();
  await page.getByRole("link", { name: "Documents", exact: true }).click();

  // Bigger than the proxy's 10 MB buffer: the upload route streams it.
  const upload = page.getByRole("region", { name: "Documents" }).locator("form").last();
  await upload.getByLabel("Category").selectOption({ label: "Technical document" });
  await upload.getByLabel("Title").fill(title);
  await upload.getByLabel("File").setInputFiles({
    name: "content.mov",
    mimeType: "video/quicktime",
    buffer: Buffer.alloc(12 * 1024 * 1024, 7),
  });
  await upload.getByRole("button", { name: "Upload" }).click();
  await expect(upload.getByText("Uploaded content.mov")).toBeVisible();
  const row = page.getByRole("row", { name: new RegExp(title) });
  await expect(row).toContainText("12 MB");
  const href = await row.getByRole("link", { name: title }).getAttribute("href");
  const download = await page.request.get(href!);
  expect(download.status()).toBe(200);
  expect((await download.body()).length).toBe(12 * 1024 * 1024);
});
