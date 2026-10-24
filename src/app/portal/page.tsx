import Link from "next/link";
import { requirePortalActorOrRedirect } from "@/server/portal/session";
import { PORTAL_PERMISSIONS } from "@/server/portal/permissions";
import { clientOverview } from "@/server/portal/client";
import { formatMoney } from "@/lib/format";
import { EmptyState, PageHeader, Panel, Section } from "@/components/ui/page";

export const metadata = { title: "Home" };

export default async function PortalHome() {
  const actor = await requirePortalActorOrRedirect();
  const labels: Record<string, string> = PORTAL_PERMISSIONS[actor.kind];
  const overview = actor.kind === "CLIENT" ? await clientOverview(actor) : null;
  const awaiting = overview?.quotes?.filter((q) => q.latest.status === "ISSUED") ?? [];
  const unpaid = overview?.invoices?.filter((i) => i.outstandingMinor && i.outstandingMinor > 0n);
  const cards = overview
    ? [
        overview.projects && {
          href: "/portal/projects",
          label: "Projects",
          value: String(overview.projects.length),
        },
        overview.quotes && {
          href: "/portal/quotes",
          label: "Quotations waiting for your answer",
          value: String(awaiting.length),
        },
        unpaid && {
          href: "/portal/invoices",
          label: "Invoices with a balance due",
          value: String(unpaid.length),
        },
        overview.documents && {
          href: "/portal/documents",
          label: "Documents",
          value: String(overview.documents.length),
        },
      ].filter((c) => !!c)
    : [];
  return (
    <>
      <PageHeader
        title={`Welcome, ${actor.name}`}
        description={`You are signed in for ${actor.organisation}. You see only what HMBL shares with ${actor.organisation}.`}
      />
      {cards.length ? (
        <Section title="Shared with you">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {cards.map((c) => (
              <li key={c.href}>
                <Link href={c.href} className="block">
                  <Panel className="hover:bg-hover h-full transition-colors">
                    <p className="text-text tabular text-2xl font-semibold">{c.value}</p>
                    <p className="text-secondary text-sm">{c.label}</p>
                  </Panel>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {awaiting.length ? (
        <Section title="Waiting for your answer">
          <ul className="flex flex-col gap-2">
            {awaiting.map((q) => (
              <li key={q.id}>
                <Link href={`/portal/quotes/${q.id}`} className="text-accent hover:underline">
                  {q.number} · {q.title}
                </Link>{" "}
                <span className="text-secondary tabular text-sm">
                  {formatMoney(q.latest.totalMinor, q.latest.currency)}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
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
      {overview && !cards.length ? (
        <Section title="Shared with you">
          <EmptyState title="Nothing has been shared with you yet" />
        </Section>
      ) : null}
    </>
  );
}
