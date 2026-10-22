"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import { ENTITY_COOKIE } from "@/server/shell/entity-context";
import { requireActor } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";

const YEAR = 60 * 60 * 24 * 365;

export async function setThemePreference(value: string) {
  const theme = parseTheme(value);
  (await cookies()).set(THEME_COOKIE, theme, { path: "/", maxAge: YEAR, sameSite: "lax" });
  refresh();
}

/** Remembers which legal entity the user is working in ("all" for every entity). */
export async function setEntityContext(value: string) {
  const actor = await requireActor();
  // Only remember an entity the user can actually see; anything else means "all".
  const allowed = value !== "all" && can(actor, "organisation.view", { legalEntityId: value });
  (await cookies()).set(ENTITY_COOKIE, allowed ? value : "all", {
    path: "/",
    maxAge: YEAR,
    sameSite: "lax",
    httpOnly: true,
  });
  refresh();
}
