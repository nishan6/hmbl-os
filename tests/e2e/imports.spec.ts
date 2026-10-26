import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers/session";

test("a crew file is checked, needs a decision on its duplicate, and imports only on commit", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const name = `Import Rigger ${Date.now()}`;
  const csv = [
    "Name,Type,Phone,City,Skills",
    `${name},Freelancer,,Shillong,Rigging`,
    ",Freelancer,,,",
    "Demo Sara Sound (DEMO),Freelancer,+91 90000 00002,Guwahati,FOH mixing",
  ].join("\r\n");

  await signIn(page, DEMO.owner);
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Imports" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Imports" })).toBeVisible();
  await page.getByLabel("What the file holds").selectOption("CREW");
  await page.getByLabel("File (CSV)").setInputFiles({
    name: "crew.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("button", { name: "Read and check the file" }).click();

  await expect(page.getByRole("heading", { level: 1, name: "crew.csv" })).toBeVisible();
  const rows = page.getByRole("table").last();
  await expect(rows.getByText("Has problems")).toBeVisible();
  await expect(rows.getByText("Name: ", { exact: false })).toBeVisible();
  await expect(rows.getByText("Possible duplicate")).toBeVisible();

  // Nothing is written yet, and the duplicate blocks the commit until someone decides.
  await page.getByRole("button", { name: "Dry run" }).click();
  await expect(page.getByText("1 possible duplicates need a decision")).toBeVisible();

  await rows.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(rows.getByText("Decided: Skip this row")).toBeVisible();
  await page.getByRole("button", { name: "Dry run" }).click();
  await expect(
    page.getByText(/Ready to commit: 1 to create, 0 to update, 1 to skip/),
  ).toBeVisible();

  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Commit import" }).click();
  await expect(page.getByText("Imported", { exact: true }).first()).toBeVisible();
  await expect(rows.getByText("Created")).toBeVisible();
  await expect(rows.getByText("Not imported")).toBeVisible();
  await expect(rows.getByText("Skipped")).toBeVisible();

  await rows.getByRole("link", { name: new RegExp(name) }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
});

test("people who can't create records don't see imports", async ({ page }) => {
  await signIn(page, DEMO.viewer);
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Imports" }),
  ).toHaveCount(0);
  await page.goto("/admin/imports");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
});
