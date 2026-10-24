import { notFound, redirect } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { FieldApp } from "./field-app";

export const metadata = { title: "Field app" };

/*
 * The field app (docs/offline.md): the show day for phones at the venue,
 * kept on the device so it opens without a connection. This page only hands
 * the app who is signed in; every show comes from the pack API and is read
 * back from the device's offline database.
 */
export default async function FieldPage() {
  const actor = await requireActorOrRedirect();
  if (actor.twoFactor?.setupRequired) redirect("/");
  if (!can(actor, "production.view")) notFound();
  return <FieldApp userId={actor.id} name={actor.name} />;
}
