import { requirePortalActorOrRedirect } from "@/server/portal/session";
import { PORTAL_PERMISSIONS } from "@/server/portal/permissions";
import { EmptyState, PageHeader, Panel, Section } from "@/components/ui/page";

export const metadata = { title: "Home" };

export default async function PortalHome() {
  const actor = await requirePortalActorOrRedirect();
  const labels: Record<string, string> = PORTAL_PERMISSIONS[actor.kind];
  return (
    <>
      <PageHeader
        title={`Welcome, ${actor.name}`}
        description={`You are signed in for ${actor.organisation}. You see only what HMBL shares with ${actor.organisation}.`}
      />
      <Section title="What you can do here">
        <Panel>
          <ul className="text-secondary list-disc pl-5 text-sm">
            {[...actor.permissions].map((p) => (
              <li key={p}>{labels[p] ?? p}</li>
            ))}
          </ul>
          <p className="text-muted mt-3 text-xs">To change this, ask your contact at HMBL.</p>
        </Panel>
      </Section>
      <Section title="Shared with you">
        <EmptyState title="Nothing has been shared with you yet" />
      </Section>
    </>
  );
}
