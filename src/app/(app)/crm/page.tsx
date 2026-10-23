import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, Target } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { effectiveProbability, listOpportunities, listStages } from "@/server/crm/pipeline";
import { getEntityContext } from "@/server/shell/entity-context";
import { formatDate, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CrmTabs } from "./_components/crm-tabs";
import { STAGE_STATUS } from "./_components/stage";

export const metadata = { title: "Pipeline" };

type Totals = Map<string, { value: bigint; weighted: bigint }>;

/** Sums per currency: amounts in different currencies are never added together. */
function addTo(totals: Totals, currency: string, value: bigint, probabilityBps: number | null) {
  const t = totals.get(currency) ?? { value: 0n, weighted: 0n };
  t.value += value;
  t.weighted += (value * BigInt(probabilityBps ?? 0)) / 10000n;
  totals.set(currency, t);
}

function TotalsText({ totals, weighted }: { totals: Totals; weighted?: boolean }) {
  if (!totals.size) return <span className="text-muted">—</span>;
  return (
    <span className="tabular">
      {[...totals.entries()]
        .map(([currency, t]) =>
          formatMoney(weighted ? t.weighted : t.value, currency, { code: true }),
        )
        .join(" · ")}
    </span>
  );
}

export default async function PipelinePage() {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "crm.view")) notFound();
  const { selectedId } = await getEntityContext(actor);
  const [stages, opportunities] = await Promise.all([
    listStages(actor),
    listOpportunities(actor, { legalEntityId: selectedId }),
  ]);
  const open = opportunities.filter((o) => o.stage.kind === "OPEN");
  const parked = opportunities
    .filter((o) => o.stage.kind !== "OPEN")
    .sort((a, b) => +(b.closedAt ?? b.updatedAt) - +(a.closedAt ?? a.updatedAt))
    .slice(0, 25);
  const pipelineTotals: Totals = new Map();
  for (const o of open) {
    if (o.expectedValueMinor !== null) {
      addTo(pipelineTotals, o.currency, o.expectedValueMinor, effectiveProbability(o));
    }
  }
  const columns = stages
    .filter((s) => s.kind === "OPEN")
    .map((stage) => {
      const items = open.filter((o) => o.stageId === stage.id);
      const totals: Totals = new Map();
      for (const o of items) {
        if (o.expectedValueMinor !== null) addTo(totals, o.currency, o.expectedValueMinor, null);
      }
      return { stage, items, totals };
    });

  return (
    <>
      <PageHeader
        title="Pipeline"
        description="Open opportunities by stage. Values are the salespeople's estimates, before tax; quoted and contract values come from quotes."
        breadcrumbs={[{ label: "CRM", href: "/crm" }, { label: "Pipeline" }]}
        actions={
          can(actor, "crm.create") ? (
            <Button asChild variant="primary">
              <Link href="/crm/opportunities/new">
                <Plus aria-hidden />
                New opportunity
              </Link>
            </Button>
          ) : null
        }
      />
      <CrmTabs current="/crm" />

      <dl className="mb-6 grid gap-4 sm:grid-cols-3">
        <div>
          <dt className="text-muted text-xs">Open opportunities</dt>
          <dd className="text-text tabular text-lg font-semibold">{open.length}</dd>
        </div>
        <div>
          <dt className="text-muted text-xs">Opportunity value</dt>
          <dd className="text-text text-md font-semibold">
            <TotalsText totals={pipelineTotals} />
          </dd>
        </div>
        <div>
          <dt className="text-muted text-xs">Weighted by win probability</dt>
          <dd className="text-text text-md font-semibold">
            <TotalsText totals={pipelineTotals} weighted />
          </dd>
        </div>
      </dl>

      {open.length || parked.length ? (
        <div
          tabIndex={0}
          role="region"
          aria-label="Pipeline board"
          className="-mx-1 mb-8 flex gap-3 overflow-x-auto px-1 pb-2"
        >
          {columns.map(({ stage, items, totals }) => (
            <section
              key={stage.id}
              aria-labelledby={`stage-${stage.id}`}
              className="bg-sunken flex w-64 shrink-0 flex-col gap-2 rounded-lg p-2"
            >
              <header className="px-1">
                <h2 id={`stage-${stage.id}`} className="text-text text-sm font-semibold">
                  {stage.name}{" "}
                  <span className="text-muted tabular font-normal">{items.length}</span>
                </h2>
                <p className="text-muted text-xs">
                  <TotalsText totals={totals} />
                </p>
              </header>
              {items.map((o) => (
                <article
                  key={o.id}
                  className="border-separator bg-surface rounded-md border p-2.5 shadow-sm"
                >
                  <h3 className="text-base font-medium">
                    <Link href={`/crm/opportunities/${o.id}`} className="text-text hover:underline">
                      {o.title}
                    </Link>
                  </h3>
                  <p className="text-secondary truncate text-sm">{o.client.name}</p>
                  <p className="text-muted mt-1 flex justify-between gap-2 text-xs">
                    <span className="tabular">
                      {o.expectedValueMinor === null
                        ? "No value"
                        : formatMoney(o.expectedValueMinor, o.currency)}
                    </span>
                    <span>{o.expectedCloseDate ? formatDate(o.expectedCloseDate, "UTC") : ""}</span>
                  </p>
                </article>
              ))}
            </section>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Target}
          title="No opportunities yet"
          description="Capture each enquiry as an opportunity. Quotes are built from them."
        />
      )}

      {parked.length ? (
        <Section title="On hold and closed" description="Most recent first.">
          <Table dense>
            <THead>
              <tr>
                <TH>Opportunity</TH>
                <TH>Client</TH>
                <TH>Outcome</TH>
                <TH>Reason</TH>
                <TH align="right">Value</TH>
              </tr>
            </THead>
            <TBody>
              {parked.map((o) => (
                <TR key={o.id}>
                  <TD className="font-medium">
                    <Link
                      href={`/crm/opportunities/${o.id}`}
                      className="text-accent hover:underline"
                    >
                      {o.title}
                    </Link>
                  </TD>
                  <TD className="text-secondary">{o.client.name}</TD>
                  <TD>
                    <StatusBadge status={STAGE_STATUS[o.stage.kind]!} />
                  </TD>
                  <TD className="text-secondary max-w-xs truncate">{o.outcomeReason ?? "—"}</TD>
                  <TD align="right">
                    {o.expectedValueMinor === null
                      ? "—"
                      : formatMoney(o.expectedValueMinor, o.currency)}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      ) : null}
    </>
  );
}
