import { expect, test } from "@playwright/test";
import { DEMO, enterPassword, signIn } from "./helpers/session";

const CLIENT = "client@demo.hmbl.test";
const GALA = "New Year gala: stage, AV and crew (DEMO)";

test("the demo client sees only what HMBL shared, and sends information", async ({ page }) => {
  await enterPassword(page, CLIENT);
  await expect(page.getByRole("heading", { level: 1, name: /^Welcome, / })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Portal" });

  await nav.getByRole("link", { name: "Projects" }).click();
  await page.getByRole("link", { name: GALA }).click();
  await expect(page.getByRole("heading", { level: 1, name: GALA })).toBeVisible();
  await expect(page.getByRole("region", { name: "Payment milestones" })).toBeVisible();
  // Nothing internal: no budget, costs or margin anywhere on the page.
  await expect(page.locator("main")).not.toContainText(/budget|cost|margin/i);

  const stamp = Date.now().toString(36);
  const send = page.getByRole("region", { name: "Send HMBL information" });
  await send.getByLabel("Subject").fill(`Load-in ${stamp}`);
  await send.getByLabel("Details").fill("Gate 3 after 22:00. Ask for Ravi at security.");
  await send.getByRole("button", { name: "Send to HMBL" }).click();
  await expect(send.getByText("Sent to HMBL")).toBeVisible();
  await expect(page.getByRole("region", { name: "What your organisation sent" })).toContainText(
    `Load-in ${stamp}`,
  );

  await nav.getByRole("link", { name: "Quotations" }).click();
  await page.getByRole("link", { name: GALA }).click();
  await expect(page.getByRole("heading", { level: 1, name: GALA })).toBeVisible();
  await expect(page.getByText("Accepted", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept this quotation" })).toHaveCount(0);

  await nav.getByRole("link", { name: "Invoices" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Invoices" })).toBeVisible();

  await nav.getByRole("link", { name: "Documents" }).click();
  const doc = page.getByRole("link", { name: "Run of show (DEMO)" });
  const href = await doc.getAttribute("href");
  const response = await page.request.get(href!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-disposition"]).toMatch(/^attachment/);

  // Ids the client wasn't given read as not found, and HMBL OS stays closed.
  await page.goto("/portal/projects/00000000-0000-0000-0000-000000000000");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Page not found");
  expect(
    (await page.request.get("/api/portal/documents/00000000-0000-0000-0000-000000000000")).status(),
  ).toBe(404);
  await page.goto("/projects");
  await expect(page).toHaveURL(/\/portal$/);
});

test("staff choose which documents the client sees", async ({ page }) => {
  await signIn(page, DEMO.owner);
  await page.goto("/projects");
  await page
    .getByRole("row", { name: new RegExp(GALA.replace(/[()]/g, "\\$&")) })
    .getByRole("link", { name: /^P-/ })
    .click();
  const portal = page.getByRole("region", { name: "Client portal", exact: true });
  await expect(portal).toContainText("Shared with the client");

  await expect(page.getByRole("region", { name: "From the client portal" })).toBeVisible();
  await page.goto(`${new URL(page.url()).pathname}/documents`);
  const row = page.getByRole("row", { name: /Run of show \(DEMO\)/ });
  await expect(row).toContainText("Shared with the client");
  await row.getByRole("button", { name: "Stop sharing Run of show (DEMO)" }).click();
  await expect(
    row.getByRole("button", { name: "Share with the client Run of show (DEMO)" }),
  ).toBeVisible();
  await expect(row).not.toContainText("Shared with the client");
  await row.getByRole("button", { name: "Share with the client Run of show (DEMO)" }).click();
  await expect(row).toContainText("Shared with the client");
});
