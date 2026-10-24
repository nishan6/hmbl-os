import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import {
  canSeeCrewSensitive,
  crewLinkOptions,
  crewSkills,
  CREW_KINDS,
} from "@/server/crew/members";
import { PageHeader } from "@/components/ui/page";
import { createCrewAction } from "../actions";
import { CrewForm } from "../crew-form";

export const metadata = { title: "New crew member" };

export default async function NewCrewPage() {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "crew.create") || !can(actor, "crew.edit")) notFound();
  const [{ users, vendors }, skills] = await Promise.all([
    crewLinkOptions(actor),
    crewSkills(actor),
  ]);
  return (
    <>
      <PageHeader
        title="New crew member"
        description="Staff and freelancers HMBL puts on projects. Shared by every legal entity."
        breadcrumbs={[{ label: "Crew", href: "/crew" }, { label: "New crew member" }]}
      />
      <CrewForm
        action={createCrewAction}
        defaults={{ kind: "FREELANCER" }}
        kinds={CREW_KINDS}
        users={users.map((u) => ({ id: u.id, label: `${u.name} (${u.email})` }))}
        vendors={vendors.map((v) => ({ id: v.id, label: v.name }))}
        skills={skills}
        sensitive={canSeeCrewSensitive(actor)}
        submitLabel="Add crew member"
        cancelHref="/crew"
      />
    </>
  );
}
