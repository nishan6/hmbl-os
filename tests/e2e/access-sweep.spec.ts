import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { DEMO, enterPassword, signIn } from "./helpers/session";

/*
 * Walks every page and API route in the app (spec §30 Stage 9: access
 * controls and portal isolation) as someone signed out, as a client portal
 * user, and as a viewer, and checks each is turned away. Routes come from
 * the file system, so a new page is swept without editing this file.
 */

const APP = path.resolve("src/app");
const NOBODY = "00000000-0000-0000-0000-000000000000";

function find(dir: string, file: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return find(full, file);
    return entry === file ? [full] : [];
  });
}

/** `src/app/(app)/projects/[id]/page.tsx` → `/projects/<nobody>`. */
function url(file: string) {
  const parts = path
    .relative(APP, path.dirname(file))
    .split(path.sep)
    .filter((p) => p && !/^\(.*\)$/.test(p))
    .map((p) => (/^\[\.\.\./.test(p) ? "x" : /^\[/.test(p) ? NOBODY : p));
  return `/${parts.join("/")}`;
}

const pages = find(APP, "page.tsx").map(url);
const apis = find(path.join(APP, "api"), "route.ts").map(url);

/** Open on purpose: see tests/unit/server-boundaries.test.ts for the reasons. */
const PUBLIC_PAGES = ["/sign-in", `/invite/${NOBODY}`];
const PUBLIC_APIS = ["/api/auth/x", "/api/health", `/api/calendar/${NOBODY}`];

const internal = pages.filter(
  (p) => !PUBLIC_PAGES.includes(p) && !p.startsWith("/portal") && !p.startsWith("/print/portal"),
);
const portal = pages.filter((p) => p.startsWith("/portal") || p.startsWith("/print/portal"));

async function landing(request: APIRequestContext, target: string) {
  const response = await request.get(target);
  const body = await response.text();
  return {
    target,
    status: response.status(),
    path: new URL(response.url()).pathname,
    // Pages stream with a 200 before notFound() is reached; Next marks the page instead.
    notFound: response.status() === 404 || body.includes("NEXT_HTTP_ERROR_FALLBACK;404"),
  };
}

test("the sweep finds the app's routes", () => {
  expect(internal.length).toBeGreaterThan(120);
  expect(portal.length).toBeGreaterThan(10);
  expect(apis.length).toBeGreaterThan(10);
});

test("someone signed out is sent to sign in from every page and refused by every API", async ({
  playwright,
}) => {
  const anonymous = await playwright.request.newContext({
    baseURL: test.info().project.use.baseURL,
  });
  const leaks = [];
  for (const target of [...internal, ...portal]) {
    const r = await landing(anonymous, target);
    if (r.path !== "/sign-in") leaks.push(r);
  }
  for (const target of apis.filter((a) => !PUBLIC_APIS.includes(a))) {
    for (const method of ["GET", "POST"] as const) {
      const response = await anonymous.fetch(target, { method, maxRedirects: 0 });
      if (response.status() < 300 || response.status() >= 500)
        leaks.push({ target, method, status: response.status() });
    }
  }
  expect(leaks).toEqual([]);
  await anonymous.dispose();
});

test("a client portal user can't open any internal page or API", async ({ page }) => {
  test.setTimeout(180_000);
  await enterPassword(page, "client@demo.hmbl.test");
  await expect(page.getByRole("heading", { level: 1, name: /^Welcome, / })).toBeVisible();
  const leaks = [];
  for (const target of internal) {
    const r = await landing(page.request, target);
    if (!(r.path.startsWith("/portal") || r.path === "/sign-in" || r.notFound)) leaks.push(r);
  }
  for (const target of apis.filter(
    (a) => !PUBLIC_APIS.includes(a) && !a.startsWith("/api/portal"),
  )) {
    const response = await page.request.get(target, { maxRedirects: 0 });
    if (response.status() < 300 || response.status() >= 500)
      leaks.push({ target, status: response.status() });
  }
  expect(leaks).toEqual([]);
});

test("staff can't open the portal, and a viewer can't open administration or finance writes", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, DEMO.viewer);
  const leaks = [];
  for (const target of portal) {
    const r = await landing(page.request, target);
    if (r.path.startsWith("/portal") && !r.notFound && r.status === 200) leaks.push(r);
  }
  const writes = internal.filter(
    (p) => p.endsWith("/new") || p.startsWith("/admin/readiness") || p.startsWith("/admin/imports"),
  );
  expect(writes.length).toBeGreaterThan(10);
  for (const target of writes) {
    const r = await landing(page.request, target);
    if (!r.notFound && r.path === target) leaks.push(r);
  }
  expect(leaks).toEqual([]);
});

test("every response carries the security headers", async ({ playwright }) => {
  const anonymous = await playwright.request.newContext({
    baseURL: test.info().project.use.baseURL,
  });
  for (const target of ["/sign-in", "/api/health", "/projects"]) {
    const headers = (await anonymous.get(target, { maxRedirects: 0 })).headers();
    expect(headers["x-frame-options"], target).toBe("DENY");
    expect(headers["x-content-type-options"], target).toBe("nosniff");
    expect(headers["content-security-policy"], target).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"], target).toContain("form-action 'self'");
    expect(headers["x-powered-by"], target).toBeUndefined();
  }
  await anonymous.dispose();
});
