import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers/session";

test("closeout shows what the operational records still hold open, linked to each record", async ({
  page,
}) => {
  await signIn(page, DEMO.owner);
  await page.goto("/projects?q=P-2627-0001");
  await page
    .getByRole("link", { name: /^P-2627-0001/ })
    .first()
    .click();
  await page.getByRole("link", { name: "Closeout", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Closeout checklist" })).toBeVisible();

  // The demo hazers are received and not yet returned to the rental house.
  const hire = page.getByRole("link", {
    name: /2 × DEMO hazer with fluid, per show still on hire/,
  });
  await expect(hire).toBeVisible();
  const vendorBills = page.getByRole("listitem").filter({
    has: page.getByRole("heading", { name: "Vendor bills received" }),
  });
  await expect(vendorBills.getByRole("button", { name: "Mark done" })).toHaveCount(0);

  await hire.click();
  await expect(page.getByRole("heading", { level: 1, name: /^PO\// })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Return to the vendor" })).toBeVisible();
});
