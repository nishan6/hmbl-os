import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers/session";

test("a vendor's agreement is uploaded on the vendor and found in the library", async ({
  page,
}) => {
  const stamp = Date.now().toString(36).toUpperCase();
  const title = `E2E rate agreement ${stamp}`;
  await signIn(page, DEMO.owner);
  await page.goto("/procurement/vendors");
  await page
    .getByRole("link", { name: /\(DEMO\)/ })
    .first()
    .click();
  const upload = page.getByRole("region", { name: "Documents" }).locator("form").last();
  await upload.getByLabel("Category").selectOption({ label: "Contract" });
  await upload.getByLabel("Title").fill(title);
  await upload.getByLabel("File").setInputFiles({
    name: "rates.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 demo"),
  });
  await upload.getByRole("button", { name: "Upload" }).click();
  await expect(upload.getByText("Uploaded rates.pdf")).toBeVisible();
  await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();

  await page.goto(`/documents?q=${encodeURIComponent(stamp)}`);
  const row = page.getByRole("row", { name: new RegExp(title) });
  await expect(row).toContainText("Vendor");
  await expect(row).toContainText(/31 Mar 20\d\d/);
});
