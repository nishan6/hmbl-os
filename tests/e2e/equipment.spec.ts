import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers/session";

test("an asset with a fault only returns to service once the job is done", async ({ page }) => {
  const stamp = Date.now().toString(36).toUpperCase();
  const name = `E2E Profile ${stamp}`;
  await signIn(page, DEMO.owner);
  await page.goto("/equipment/new");
  await page.getByRole("textbox", { name: /^Name/ }).fill(name);
  await page.getByRole("textbox", { name: /^SKU/ }).fill(`E2E-${stamp}`);
  await page.getByLabel("Category").selectOption({ label: "Lighting (DEMO)" });
  await page.getByLabel("Rental per day").fill("2500");
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  const assets = page.getByRole("region", { name: "Assets" });
  await assets.getByRole("textbox", { name: /^Asset tag/ }).fill(`E2E-${stamp}-1`);
  await assets.getByRole("button", { name: "Add asset" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: new RegExp(`E2E-${stamp}-1`) }),
  ).toBeVisible();

  // A new asset in an inspected category is due an inspection: do it first.
  const jobs = page.getByRole("region", { name: "Maintenance" });
  await jobs.getByLabel("Kind").selectOption({ label: "Inspection" });
  await jobs.getByRole("textbox", { name: "What", exact: true }).fill("First inspection");
  await jobs.getByRole("button", { name: "Open job" }).click();
  await jobs.getByRole("checkbox", { name: "Safety bond fitted" }).check();
  await jobs.getByRole("checkbox", { name: "Clamp and bolt secure" }).check();
  await jobs.getByRole("checkbox", { name: "Lens clean" }).check();
  await jobs.getByRole("textbox", { name: /^What was found/ }).fill("All fine");
  await jobs.getByRole("button", { name: "Mark done" }).click();
  await expect(jobs.getByText("Passed: Lens clean")).toBeVisible();

  await jobs.getByLabel("Kind").selectOption({ label: "Fault" });
  await jobs.getByRole("textbox", { name: "What", exact: true }).fill("Gobo wheel stuck");
  await jobs.getByRole("button", { name: "Open job" }).click();
  const back = page.getByRole("region", { name: "Return to service" });
  await expect(back.getByText("1 maintenance job is still open")).toBeVisible();

  await jobs.getByRole("textbox", { name: /^What was found/ }).fill("Freed the gobo wheel");
  await jobs.getByRole("button", { name: "Mark done" }).click();
  await back.getByRole("button", { name: "Return to service" }).click();
  await expect(page.getByRole("region", { name: "Return to service" })).toHaveCount(0);
  await expect(page.getByText("Available").first()).toBeVisible();
});

test("stock is reserved for a project, dispatched and checked back in", async ({ page }) => {
  const stamp = Date.now().toString(36).toUpperCase();
  const name = `E2E Clamp ${stamp}`;
  await signIn(page, DEMO.owner);
  await page.goto("/equipment/new");
  await page.getByRole("textbox", { name: /^Name/ }).fill(name);
  await page.getByRole("textbox", { name: /^SKU/ }).fill(`E2E-CL-${stamp}`);
  await page.getByLabel("Category").selectOption({ label: "Lighting (DEMO)" });
  await page.getByLabel("Tracked").selectOption({ label: "By quantity" });
  await page.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const stock = page.getByRole("region", { name: "Stock" });
  await stock
    .getByLabel("Location")
    .selectOption({ label: "DEMO-WH-MUM · Mumbai equipment store (DEMO)" });
  await stock.getByRole("textbox", { name: /^Quantity/ }).fill("10");
  await stock.getByRole("textbox", { name: /^Reason/ }).fill("Bought");
  await stock.getByRole("button", { name: "Update stock" }).click();
  await expect(stock.getByRole("row", { name: /DEMO-WH-MUM/ })).toContainText("10");

  await page.goto("/projects");
  await page
    .getByRole("row", { name: /New Year gala/ })
    .getByRole("link", { name: /^P-/ })
    .click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}$/);
  await page.goto(`${page.url()}/resources`);
  const bookings = page.getByRole("region", { name: "Equipment bookings" });
  await bookings
    .getByRole("combobox", { name: "Equipment", exact: true })
    .selectOption({ label: `${name} (E2E-CL-${stamp})` });
  await bookings.getByLabel("Quantity").fill("4");
  await bookings.getByLabel("First day").fill("2098-05-01");
  await bookings.getByLabel("Last day").fill("2098-05-03");
  await bookings.getByRole("button", { name: "Reserve" }).click();
  await bookings.getByRole("link", { name }).click();

  const moves = page.getByRole("region", { name: "Dispatch and check-in" });
  await moves.getByLabel("From").selectOption({ label: "DEMO-WH-MUM · 10 in service" });
  await moves.getByRole("textbox", { name: /^Quantity/ }).fill("4");
  await moves.getByRole("button", { name: "Dispatch" }).click();
  await expect(page.getByRole("region", { name: "History" })).toContainText("Dispatched");

  await moves.getByLabel("Back in good order").fill("3");
  await moves.getByLabel("Back damaged").fill("1");
  await moves
    .getByLabel("Back to")
    .selectOption({ label: "DEMO-WH-MUM · Mumbai equipment store (DEMO)" });
  await moves.getByRole("button", { name: "Check in" }).click();
  await expect(page.getByText("Closed").first()).toBeVisible();

  await page.goto("/equipment");
  await page.getByRole("link", { name }).click();
  await expect(
    page.getByRole("region", { name: "Stock" }).getByRole("row", { name: /DEMO-WH-MUM/ }),
  ).toContainText("9");
});
