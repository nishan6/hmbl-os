"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, type FormState } from "@/server/http/action-result";
import { NOTIFICATION_KINDS } from "@/server/notifications/notify";
import { markAllRead, markRead, saveNotificationPreferences } from "@/server/notifications/service";

/** Marks it read and opens what it is about. */
export async function openNotificationAction(id: string, _: FormState, formData: FormData) {
  let href: string | null = null;
  const state = await attempt(formData, async () => {
    href = (await markRead(await requireActor(), id)).href;
  });
  if (state.status !== "success") return state;
  if (href) redirect(href);
  refresh();
  return state;
}

export async function markAllReadAction(_: FormState, formData: FormData) {
  const state = await attempt(formData, async () => markAllRead(await requireActor()), "Done");
  if (state.status === "success") refresh();
  return state;
}

export async function savePreferencesAction(_: FormState, formData: FormData) {
  return attempt(
    formData,
    async () =>
      saveNotificationPreferences(await requireActor(), {
        choices: Object.keys(NOTIFICATION_KINDS).map((kind) => ({
          kind: kind as keyof typeof NOTIFICATION_KINDS,
          inApp: formData.get(`inApp:${kind}`) === "on",
          email: formData.get(`email:${kind}`) === "on",
        })),
      }),
    "Saved",
  );
}
