"use server";

import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, toFormState, type FormState } from "@/server/http/action-result";
import { createCalendarFeed, revokeCalendarFeed } from "@/server/integrations/calendar-feed";
import { env } from "@/lib/env";

export type FeedState = FormState & { link?: string };

/** Makes a new link, replacing any earlier one, and hands it back once. */
export async function createFeedAction(): Promise<FeedState> {
  try {
    const { token } = await createCalendarFeed(await requireActor());
    refresh();
    return {
      status: "success",
      savedAt: Date.now(),
      link: new URL(`/api/calendar/${token}.ics`, env().APP_URL).toString(),
    };
  } catch (error) {
    return toFormState(error, {});
  }
}

export async function revokeFeedAction(_: FormState, formData: FormData) {
  const state = await attempt(
    formData,
    async () => revokeCalendarFeed(await requireActor()),
    "Calendar link turned off",
  );
  if (state.status === "success") refresh();
  return state;
}
