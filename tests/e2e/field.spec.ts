import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { DEMO, signIn } from "./helpers/session";

/*
 * The field app offline (docs/offline.md). The pack API is answered with a
 * fixed show so the test doesn't depend on today's date; what goes into a
 * real pack is covered by tests/integration/show-pack.test.ts.
 */

const SHOW_ID = "00000000-0000-4000-8000-00000000e2e7";

function fixturePack(userId: string) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    version: 1,
    userId,
    syncedAt: new Date().toISOString(),
    show: {
      id: SHOW_ID,
      number: "E2E-001",
      name: "E2E field show",
      status: "READY",
      venue: "Dome, Mumbai",
      client: null,
      entity: "HMBL",
      timeZone: "Asia/Kolkata",
      projectManager: { name: "Priya PM", email: "pm@demo.hmbl.test" },
      producer: null,
    },
    can: { post: true },
    days: [
      {
        date: today,
        running: [
          {
            id: "r1",
            startTime: "19:30",
            durationMinutes: 30,
            title: "Doors open",
            owner: "Front of house",
            location: null,
            notes: null,
          },
        ],
        callSheet: {
          revision: 2,
          publishedAt: new Date().toISOString(),
          notes: "Gate 3",
          crew: [
            {
              name: "Kiran Rigger",
              role: "Rigger",
              callTime: "07:00",
              reportTo: null,
              phone: "+91 98200 00042",
            },
          ],
        },
        equipment: [],
        travel: [],
        movements: [],
      },
    ],
    checklists: [
      {
        id: "c1",
        title: "Load-in",
        day: today,
        items: [
          {
            id: "i1",
            label: "Barriers in place",
            done: false,
            doneAt: null,
            doneBy: null,
            note: null,
            version: 1,
          },
        ],
      },
    ],
    notes: [],
    status: null,
    log: [],
  };
}

/** Serves the fixture show in place of the real ones, for the signed-in user. */
async function serveFixture(context: BrowserContext) {
  await context.route("**/api/production/packs", async (route) => {
    const real = await route.fetch();
    if (real.status() !== 200) return route.fulfill({ response: real });
    const { userId } = (await real.json()) as { userId: string };
    await route.fulfill({
      json: {
        userId,
        shows: [{ id: SHOW_ID, number: "E2E-001", name: "E2E field show", days: [] }],
      },
    });
  });
  await context.route(`**/api/production/packs/${SHOW_ID}`, async (route) => {
    const list = await route.fetch({ url: route.request().url().replace(`/${SHOW_ID}`, "") });
    const { userId } = (await list.json()) as { userId: string };
    await route.fulfill({ json: fixturePack(userId) });
  });
}

/** Waits until the app and its service worker can open without a connection. */
async function waitUntilKept(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(async () => Boolean(await caches.match("/field")));
}

const offlineData = (page: Page) =>
  page.evaluate(async () => ({
    databases: (await indexedDB.databases()).map((d) => d.name),
    caches: await caches.keys(),
  }));

test("the venue crew open a saved show with no connection", async ({ page, context }) => {
  await serveFixture(context);
  await signIn(page, DEMO.showCrew);
  await page.goto("/field");
  await expect(page.getByRole("heading", { name: "Saved shows" })).toBeVisible();
  await page.getByRole("link", { name: /E2E field show/ }).click();
  await expect(page.getByRole("heading", { name: "E2E field show", level: 1 })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Doors open" })).toBeVisible();
  await waitUntilKept(page);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "E2E field show", level: 1 })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Kiran Rigger" })).toBeVisible();
  await expect(page.getByText("Barriers in place")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeDisabled();
  // Links inside the app still work offline.
  await page.getByRole("link", { name: "All saved shows" }).click();
  await expect(page.getByRole("link", { name: /E2E field show/ })).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText("Online", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh" })).toBeEnabled();
});

test("signing out wipes the shows kept on the device", async ({ page, context }) => {
  await serveFixture(context);
  await signIn(page, DEMO.showCrew);
  await page.goto("/field");
  await expect(page.getByRole("link", { name: /E2E field show/ })).toBeVisible();
  await waitUntilKept(page);
  expect((await offlineData(page)).databases).toContain("hmbl-field");

  await page.goto("/production");
  await page.getByRole("button", { name: /^Account:/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL(/\/sign-in/);
  expect(await offlineData(page)).toEqual({ databases: [], caches: [] });
});

test("an ended session wipes the device the next time the app is online", async ({
  page,
  context,
}) => {
  await serveFixture(context);
  await signIn(page, DEMO.showCrew);
  await page.goto("/field");
  await expect(page.getByRole("link", { name: /E2E field show/ })).toBeVisible();

  // The server no longer knows the session (signed out elsewhere, or disabled).
  await context.unroute("**/api/production/packs");
  await context.route("**/api/production/packs", (route) =>
    route.fulfill({ status: 401, json: { error: "Sign in to continue." } }),
  );
  // This browser is in fact still signed in, so stop sign-in sending it back.
  await context.route(
    (url) => url.pathname === "/sign-in",
    (route) => route.fulfill({ contentType: "text/html", body: "<title>Sign in</title>" }),
  );
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.waitForURL(
    (url) => url.pathname === "/sign-in" && url.searchParams.get("next") === "/field",
  );
  expect((await offlineData(page)).databases).not.toContain("hmbl-field");
});

test("the field app meets WCAG 2.2 AA", async ({ page, context }) => {
  await serveFixture(context);
  await signIn(page, DEMO.showCrew);
  await page.goto(`/field?show=${SHOW_ID}`);
  await expect(page.getByRole("cell", { name: "Doors open" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(violations.map((v) => v.id)).toEqual([]);
});
