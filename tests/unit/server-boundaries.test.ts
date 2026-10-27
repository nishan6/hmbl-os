import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Every way into HMBL OS from a browser checks who is asking, on the server
 * (spec §32 E, docs/security.md). Pages, server actions and route handlers
 * are read as source, so a new one that forgets the check fails here before
 * it ships. Services then check the permission and the legal entity.
 */

const ROOT = path.resolve("src/app");

function files(dir: string, name: (f: string) => boolean): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return files(full, name);
    return name(entry) ? [full] : [];
  });
}

const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");

/** Calls that establish who is asking, for staff or portal users. */
const GUARDS =
  /\b(requireActor|requireActorOrRedirect|requirePermission|requirePortalActor|requirePortalActorOrRedirect|requirePortal|requireClientPortal|loadFinancePage)\(/;

/** Open on purpose, with the reason. Anything else must call a guard. */
const PUBLIC_PAGES: Record<string, string> = {
  "sign-in/page.tsx": "the sign-in form",
  "invite/[token]/page.tsx": "accepting a portal invitation; the token is the key",
};
const PUBLIC_ROUTES: Record<string, string> = {
  "api/auth/[...all]/route.ts": "Better Auth's own sign-in endpoints, rate limited",
  "api/health/route.ts": "says only whether the database answers",
  "api/calendar/[token]/route.ts": "the calendar feed; the secret in the link is the key",
};
const PUBLIC_ACTIONS: Record<string, string> = {
  "invite/[token]/actions.ts#acceptInvitationAction":
    "accepting a portal invitation; the token and the invited email are checked",
  "(app)/actions.ts#setThemePreference": "only sets the light or dark theme cookie",
};

/** Each exported function's source, up to the next export. */
function exportedFunctions(source: string) {
  const parts = source.split(/(?=^export (?:async )?function )/m).slice(1);
  return parts.map((body) => ({ name: /function (\w+)/.exec(body)![1]!, body }));
}

describe("server boundaries", () => {
  it("every page checks who is signed in, unless it is public on purpose", () => {
    const pages = files(ROOT, (f) => f === "page.tsx");
    expect(pages.length).toBeGreaterThan(150);
    const unguarded = pages
      .map((f) => ({ file: rel(f), source: readFileSync(f, "utf8") }))
      .filter(({ file, source }) => !PUBLIC_PAGES[file] && !GUARDS.test(source))
      .map(({ file }) => file);
    expect(unguarded).toEqual([]);
  });

  it("every server action checks who is asking", () => {
    const modules = files(ROOT, (f) => /\.tsx?$/.test(f))
      .map((f) => ({ file: rel(f), source: readFileSync(f, "utf8") }))
      .filter(({ source }) => /^["']use server["'];?/m.test(source));
    expect(modules.length).toBeGreaterThan(30);
    const unguarded = modules.flatMap(({ file, source }) =>
      exportedFunctions(source)
        .filter(({ name, body }) => !PUBLIC_ACTIONS[`${file}#${name}`] && !GUARDS.test(body))
        .map(({ name }) => `${file}#${name}`),
    );
    expect(unguarded).toEqual([]);
  });

  it("every route handler checks who is asking, unless it is public on purpose", () => {
    const routes = files(ROOT, (f) => f === "route.ts");
    const unguarded = routes
      .map((f) => ({ file: rel(f), source: readFileSync(f, "utf8") }))
      .filter(({ file, source }) => !PUBLIC_ROUTES[file] && !GUARDS.test(source))
      .map(({ file }) => file);
    expect(unguarded).toEqual([]);
  });

  it("the interface never reaches the database directly", () => {
    const ui = [
      ...files(ROOT, (f) => /\.tsx?$/.test(f)),
      ...files(path.resolve("src/components"), (f) => /\.tsx?$/.test(f)),
    ];
    const direct = ui
      .filter((f) =>
        /^import (?!type )[^;]*from ["']@\/(server\/db|generated\/prisma\/client)["']/m.test(
          readFileSync(f, "utf8"),
        ),
      )
      .map((f) => path.relative(path.resolve("src"), f));
    // The health check only asks the database whether it answers.
    expect(direct).toEqual(["app/api/health/route.ts"]);
  });
});
