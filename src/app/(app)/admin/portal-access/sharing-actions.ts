"use server";

import { refresh } from "next/cache";
import type { PortalShareKind } from "@/generated/prisma/enums";
import { requireActor } from "@/server/auth/session";
import { attempt, type FormState } from "@/server/http/action-result";
import { shareWithClient, stopSharing } from "@/server/portal/sharing";

export async function shareAction(
  kind: PortalShareKind,
  id: string,
  _: FormState,
  formData: FormData,
) {
  const state = await attempt(
    formData,
    async () => shareWithClient(await requireActor(), { kind, id }),
    "Shared with the client",
  );
  if (state.status === "success") refresh();
  return state;
}

export async function stopSharingAction(
  kind: PortalShareKind,
  id: string,
  _: FormState,
  formData: FormData,
) {
  const state = await attempt(
    formData,
    async () => stopSharing(await requireActor(), { kind, id }),
    "No longer shared",
  );
  if (state.status === "success") refresh();
  return state;
}
