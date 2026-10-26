import Link from "next/link";
import { requireActorOrRedirect } from "@/server/auth/session";
import { listIntegrations, type IntegrationState } from "@/server/integrations/status";
import { PageHeader, Section } from "@/components/ui/page";
import { StatusBadge, type StatusKey } from "@/components/ui/status";

export const metadata = { title: "Integrations" };

const STATE: Record<IntegrationState, { status: StatusKey; label: string }> = {
  working: { status: "active", label: "Working" },
  not_set_up: { status: "on_hold", label: "Not set up" },
  not_built: { status: "disabled", label: "Not connected" },
};

const GROUPS: { state: IntegrationState; title: string; description: string }[] = [
  {
    state: "working",
    title: "Working",
    description: "Built into HMBL OS. They need no outside account.",
  },
  {
    state: "not_set_up",
    title: "Ready, but not set up",
    description: "HMBL OS is ready for these, but no provider is configured, so nothing is sent.",
  },
  {
    state: "not_built",
    title: "Not connected",
    description:
      "No connection exists yet. Each needs an account, permissions and an agreed use before it is built.",
  },
];

export default async function IntegrationsPage() {
  const actor = await requireActorOrRedirect();
  const integrations = await listIntegrations(actor);

  return (
    <>
      <PageHeader
        title="Integrations"
        description="What HMBL OS connects to, and whether each connection works today. A status shows Working only when it really does."
        breadcrumbs={[{ label: "Administration" }, { label: "Integrations" }]}
      />
      {GROUPS.map((g) => {
        const rows = integrations.filter((i) => i.state === g.state);
        if (!rows.length) return null;
        return (
          <Section key={g.state} title={g.title} description={g.description}>
            <ul className="grid gap-3 lg:grid-cols-2">
              {rows.map((i) => (
                <li
                  key={i.key}
                  className="border-separator bg-surface flex flex-col gap-3 rounded-lg border p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-text text-base font-medium">
                      {i.href ? (
                        <Link href={i.href} className="text-accent hover:underline">
                          {i.name}
                        </Link>
                      ) : (
                        i.name
                      )}
                    </h3>
                    <StatusBadge {...STATE[i.state]} />
                  </div>
                  <p className="text-secondary text-sm">{i.detail}</p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                    <dt className="text-secondary">Use</dt>
                    <dd>{i.use}</dd>
                    <dt className="text-secondary">Source of truth</dt>
                    <dd>{i.sourceOfTruth}</dd>
                    <dt className="text-secondary">Direction</dt>
                    <dd>{i.direction}</dd>
                    {i.facts.length ? (
                      <>
                        <dt className="text-secondary">Now</dt>
                        <dd className="tabular">{i.facts.join(" · ")}</dd>
                      </>
                    ) : null}
                  </dl>
                </li>
              ))}
            </ul>
          </Section>
        );
      })}
    </>
  );
}
