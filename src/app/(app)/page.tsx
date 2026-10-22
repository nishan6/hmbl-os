import { requireActorOrRedirect } from "@/server/auth/session";
import { permissionsOf } from "@/server/permissions/evaluate";

export default async function HomePage() {
  const actor = await requireActorOrRedirect();
  const roles = actor.grants.map((g) => g.roleKey);
  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
      <p className="mt-2 text-sm opacity-70">
        Signed in as {actor.email}. Roles: {roles.length ? roles.join(", ") : "none"} (
        {permissionsOf(actor.grants).size} permissions).
      </p>
    </div>
  );
}
