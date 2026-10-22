import { expect, test } from "@playwright/test";
import { DEMO, signIn } from "./helpers/session";

test("navigation only shows what the user may open", async ({ page }) => {
  await signIn(page, DEMO.sales);
  const nav = page.getByRole("navigation", { name: "Main" });
  await expect(nav.getByRole("link", { name: "Organisation" })).toBeVisible();
  await expect(nav.getByText("Users")).toHaveCount(0);
  await expect(nav.getByText("Audit log")).toHaveCount(0);
  // Unbuilt modules are listed but not links.
  await expect(nav.getByText("CRM")).toBeVisible();
  await expect(nav.getByRole("link", { name: /CRM/ })).toHaveCount(0);

  // Hiding the link isn't the control: the server refuses the page too.
  await page.goto("/admin/audit");
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});

test("the chosen theme applies at once and survives a reload", async ({ page }) => {
  await signIn(page, DEMO.viewer);
  const html = page.locator("html");
  await page.getByRole("button", { name: "Account: Demo Viewer" }).click();
  await page.getByRole("menuitemradio", { name: "Dark" }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");

  // The preference is saved by a server action; reload once it has landed.
  await expect
    .poll(async () => (await page.context().cookies()).find((c) => c.name === "hmbl-theme")?.value)
    .toBe("dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");

  await page.getByRole("button", { name: "Account: Demo Viewer" }).click();
  await page.getByRole("menuitemradio", { name: "Match system" }).click();
  await expect(html).not.toHaveAttribute("data-theme");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the sidebar becomes a drawer", async ({ page }) => {
    await signIn(page, DEMO.viewer);
    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();

    await page.getByRole("button", { name: "Open navigation" }).click();
    const drawer = page.getByRole("dialog", { name: "Navigation" });
    await drawer.getByRole("link", { name: "Organisation" }).click();

    await expect(drawer).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "Organisation" })).toBeVisible();
  });
});
