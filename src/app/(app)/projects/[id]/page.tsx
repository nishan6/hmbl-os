import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, Theater } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { getProject } from "@/server/projects/projects";
import { billsAwaitingApproval } from "@/server/finance/bills";
import { claimsAwaitingApproval } from "@/server/expenses/claims";
import {
  checkMove,
  isLocked,
  nextStatuses,
  PROJECT_PATH,
  PROJECT_STATUSES,
} from "@/server/projects/lifecycle";
import { REVENUE_MODELS } from "@/server/projects/schemas";
import { ACCEPTANCE_METHOD_LABELS } from "@/server/commercial/acceptance";
import { LINE_CATEGORIES } from "@/server/commercial/schemas";
import { PAYMENT_TRIGGERS } from "@/server/master-data/schemas";
import { NotFoundError } from "@/lib/errors";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { formatBps } from "@/lib/percent";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Alert, DetailList, Panel, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ProjectHeader } from "../_components/project-header";
import { PROJECT_STATUS } from "../_components/status";
import { changeStatusAction } from "../actions";
import { StatusForm } from "./status-form";
import { PortalShare } from "../../admin/portal-access/_components/portal-share";
import { projectPortalActivity } from "@/server/portal/sharing";

export const metadata = { title: "Project" };

export default async function ProjectPage({ params, searchParams }: PageProps<"/projects/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const actor = await requireActorOrRedirect();
  const p = await getProject(actor, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const scope = { legalEntityId: p.legalEntityId };
  const bills = (await billsAwaitingApproval(actor)).filter((b) =>
    b.lines.some((l) => l.project?.id === p.id),
  );
  const claims = (await claimsAwaitingApproval(actor)).filter((c) =>
    c.lines.some((l) => l.project?.id === p.id),
  );
  const canEdit = can(actor, "projects.edit", scope) && !isLocked(p.status);
  const submissions = await projectPortalActivity(actor, p.id);
  const moves = nextStatuses(p.status, p.resumeStatus).flatMap((to) => {
    const move = checkMove(p.status, to, p.resumeStatus);
    return move.ok && can(actor, move.permission, scope)
      ? [{ value: to, label: PROJECT_STATUSES[to], needsReason: move.needsReason }]
      : [];
  });

  const money = (minor: bigint) => formatMoney(minor, p.currency);
  const date = (d: Date | null) => (d ? formatDate(d, "UTC") : null);
  const eventDates =
    p.eventStartDate && p.eventEndDate && +p.eventStartDate !== +p.eventEndDate
      ? `${date(p.eventStartDate)} – ${date(p.eventEndDate)}`
      : date(p.eventStartDate ?? p.eventEndDate);
  const source = p.sourceQuoteVersion;
  const margin =
    p.budgetCostMinor !== null && p.contractValueMinor > 0n
      ? Number(((p.contractValueMinor - p.budgetCostMinor) * 10000n) / p.contractValueMinor)
      : null;
  const narrative = [
    { title: "Description", text: p.description },
    { title: "Scope", text: p.scope },
    { title: "Deliverables", text: p.deliverables },
  ].filter((n) => n.text);

  return (
    <>
      <ProjectHeader
        project={p}
        current=""
        showCosts={p.showCosts}
        actions={
          <>
            {can(actor, "production.view", scope) && !isLocked(p.status) ? (
              <Button asChild>
                <Link href={`/production/${p.id}`}>
                  <Theater aria-hidden />
                  Show day
                </Link>
              </Button>
            ) : null}
            {canEdit ? (
              <Button asChild>
                <Link href={`/projects/${p.id}/edit`}>
                  <Pencil aria-hidden />
                  Edit details
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      {query.created ? (
        <div className="mb-6">
          <Alert tone="success" title="Quote accepted and project created">
            The budget and billing milestones come from the accepted quote. Add the project manager
            and plan the work from here.
          </Alert>
        </div>
      ) : query.saved ? (
        <div className="mb-6">
          <Alert tone="success" title="Project details saved" />
        </div>
      ) : null}

      <div className="grid gap-x-8 xl:grid-cols-[3fr_1fr]">
        <div className="min-w-0">
          {bills.length ? (
            <Section
              title="Bills awaiting your approval"
              description="Suppliers' invoices Finance has entered against this project."
            >
              <Table dense>
                <THead>
                  <tr>
                    <TH>Vendor</TH>
                    <TH>Their invoice</TH>
                    <TH>Date</TH>
                    <TH align="right">Total</TH>
                  </tr>
                </THead>
                <TBody>
                  {bills.map((b) => (
                    <TR key={b.id}>
                      <TD>
                        <Link
                          href={`/finance/bills/${b.id}`}
                          className="text-accent hover:underline"
                        >
                          {b.vendor.name}
                        </Link>
                      </TD>
                      <TD className="tabular">{b.vendorInvoiceNumber}</TD>
                      <TD className="tabular text-secondary">{formatDate(b.billDate, "UTC")}</TD>
                      <TD align="right">{formatMoney(b.totalMinor, b.currency)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Section>
          ) : null}
          {claims.length ? (
            <Section
              title="Expense claims awaiting your approval"
              description="What the team spent on this project and wants back."
            >
              <Table dense>
                <THead>
                  <tr>
                    <TH>Claim</TH>
                    <TH>Claimant</TH>
                    <TH>Title</TH>
                    <TH align="right">Total</TH>
                  </tr>
                </THead>
                <TBody>
                  {claims.map((c) => (
                    <TR key={c.id}>
                      <TD className="tabular">
                        <Link href={`/expenses/${c.id}`} className="text-accent hover:underline">
                          {c.number}
                        </Link>
                      </TD>
                      <TD>{c.claimant.name}</TD>
                      <TD>{c.title}</TD>
                      <TD align="right">{formatMoney(c.totalMinor, c.currency)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Section>
          ) : null}
          <Section title="Details">
            <DetailList
              items={[
                { label: "Project type", value: p.projectType?.name },
                { label: "Revenue model", value: REVENUE_MODELS[p.revenueModel] },
                { label: "Business line", value: p.businessUnit?.name },
                { label: "Project manager", value: p.projectManager?.name },
                { label: "Producer", value: p.producer?.name },
                {
                  label: "From quote",
                  value:
                    p.quote && source ? (
                      <Link
                        href={`/quotes/${p.quote.id}?version=${source.version}`}
                        className="text-accent tabular hover:underline"
                      >
                        {p.quote.number} v{source.version}
                      </Link>
                    ) : (
                      "Created directly"
                    ),
                },
                ...(source
                  ? [
                      {
                        label: "Accepted",
                        value: source.acceptedOn
                          ? `${date(source.acceptedOn)}${
                              source.acceptanceMethod
                                ? ` · ${ACCEPTANCE_METHOD_LABELS[source.acceptanceMethod]}`
                                : ""
                            }`
                          : null,
                      },
                      { label: "Accepted by", value: source.acceptedByName },
                    ]
                  : []),
                { label: "Client PO", value: p.clientPoNumber },
                {
                  label: "Opportunity",
                  value: p.opportunity ? (
                    <Link
                      href={`/crm/opportunities/${p.opportunity.id}`}
                      className="text-accent hover:underline"
                    >
                      {p.opportunity.title}
                    </Link>
                  ) : null,
                },
                { label: "Event dates", value: eventDates },
                { label: "Venue", value: p.venue },
                { label: "Currency", value: p.currency },
                { label: "HMBL entity", value: p.legalEntity.legalName },
                { label: "Created by", value: p.createdBy.name },
              ]}
            />
            {p.locations ? (
              <div className="mt-4">
                <h3 className="text-muted text-xs">Other locations</h3>
                <p className="text-text mt-0.5 text-base whitespace-pre-line">{p.locations}</p>
              </div>
            ) : null}
          </Section>

          {narrative.length ? (
            <Section title="Scope and deliverables">
              <div className="flex flex-col gap-4">
                {narrative.map((n) => (
                  <div key={n.title}>
                    <h3 className="text-muted text-xs">{n.title}</h3>
                    <p className="text-text mt-0.5 max-w-prose text-base whitespace-pre-line">
                      {n.text}
                    </p>
                  </div>
                ))}
              </div>
            </Section>
          ) : null}

          <Section
            title="Budget"
            description={
              p.quote
                ? "The baseline from the accepted quote. Amounts are before tax."
                : "Amounts are before tax."
            }
          >
            {p.budgetLines.length ? (
              <Table dense>
                <THead>
                  <tr>
                    <TH>Line</TH>
                    <TH>Category</TH>
                    <TH align="right">Qty</TH>
                    <TH align="right">Days</TH>
                    {p.showCosts ? <TH align="right">Budget cost</TH> : null}
                    <TH align="right">Revenue</TH>
                  </tr>
                </THead>
                <TBody>
                  {p.budgetLines.map((l) => (
                    <TR key={l.id}>
                      <TD>
                        {l.section ? <p className="text-muted text-xs">{l.section}</p> : null}
                        {l.description}
                      </TD>
                      <TD className="text-secondary">{LINE_CATEGORIES[l.category]}</TD>
                      <TD align="right" className="whitespace-nowrap">
                        {l.quantity.toString()}
                        {l.unitCode ? ` ${l.unitCode}` : ""}
                      </TD>
                      <TD align="right">{l.days.toString()}</TD>
                      {p.showCosts ? (
                        <TD align="right">{l.costMinor === null ? "—" : money(l.costMinor)}</TD>
                      ) : null}
                      <TD align="right">{money(l.revenueMinor)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <p className="text-secondary text-sm">No budget lines yet.</p>
            )}
          </Section>

          {p.milestones.length ? (
            <Section
              title="Billing milestones"
              description="From the quote's payment terms. Invoicing comes with Finance."
            >
              <Table dense>
                <THead>
                  <tr>
                    <TH>Milestone</TH>
                    <TH>When</TH>
                    <TH align="right">Share</TH>
                    <TH>Due</TH>
                    <TH align="right">Amount</TH>
                  </tr>
                </THead>
                <TBody>
                  {p.milestones.map((m) => (
                    <TR key={m.id}>
                      <TD>{m.label}</TD>
                      <TD className="text-secondary">
                        {PAYMENT_TRIGGERS[m.trigger]}
                        {m.days ? ` (${m.days})` : ""}
                      </TD>
                      <TD align="right">{formatBps(m.percentBps)}</TD>
                      <TD className="tabular whitespace-nowrap">
                        {date(m.dueDate) ?? (
                          <span className="text-muted">When the date is set</span>
                        )}
                      </TD>
                      <TD align="right">{money(m.amountMinor)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Section>
          ) : null}

          {submissions.length ? (
            <Section
              title="From the client portal"
              description="Information the client sent through the portal. It can't be edited or deleted."
            >
              <ol className="flex flex-col gap-3">
                {submissions.map((sub) => (
                  <li key={sub.id}>
                    <Panel className="flex flex-col gap-1 text-sm">
                      <p className="text-text font-medium">{sub.subject}</p>
                      <p className="text-muted text-xs">
                        {sub.account.user.name} ({sub.account.user.email}) ·{" "}
                        {formatDateTime(sub.createdAt, p.legalEntity.timezone)}
                      </p>
                      <p className="text-secondary whitespace-pre-line">{sub.body}</p>
                    </Panel>
                  </li>
                ))}
              </ol>
            </Section>
          ) : null}
        </div>

        <aside className="min-w-0">
          <Section title="Lifecycle">
            <Panel className="flex flex-col gap-4">
              <ol aria-label="Lifecycle stages" className="flex flex-col gap-1 text-sm">
                {PROJECT_PATH.map((s) => {
                  const here = s === (p.resumeStatus ?? p.status);
                  return (
                    <li
                      key={s}
                      aria-current={here ? "step" : undefined}
                      className={cn(
                        "text-muted flex items-center gap-2",
                        here && "text-text font-medium",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn("size-2 rounded-full", here ? "bg-accent" : "bg-border")}
                      />
                      {PROJECT_STATUSES[s]}
                      {here && p.resumeStatus ? (
                        <StatusBadge status={PROJECT_STATUS[p.status]} />
                      ) : null}
                    </li>
                  );
                })}
              </ol>
              {moves.length ? (
                <StatusForm action={changeStatusAction.bind(null, p.id)} options={moves} />
              ) : null}
            </Panel>
          </Section>

          {p.clientId ? (
            <PortalShare actor={actor} kind="PROJECT" id={p.id} timeZone={p.legalEntity.timezone} />
          ) : null}

          <Section title="Figures">
            <Panel>
              <dl className="flex flex-col gap-2 text-base">
                <Figure label="Contract value" value={money(p.contractValueMinor)} />
                <Figure label="Tax" value={money(p.taxMinor)} />
                <Figure label="Total with tax" value={money(p.totalMinor)} strong />
                {p.budgetCostMinor !== null ? (
                  <>
                    <Figure label="Budget cost" value={money(p.budgetCostMinor)} />
                    <Figure
                      label="Planned margin"
                      value={margin === null ? "—" : formatBps(margin)}
                    />
                  </>
                ) : null}
              </dl>
            </Panel>
          </Section>

          <Section title="Status history">
            <ol className="flex flex-col gap-3 text-sm">
              {p.statusChanges.map((c) => (
                <li key={c.id} className="flex flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={PROJECT_STATUS[c.toStatus]} />
                    {c.override ? <Tag tone="danger">Override</Tag> : null}
                  </span>
                  <span className="text-muted text-xs">
                    {c.actorLabel} · {formatDateTime(c.at, p.legalEntity.timezone)}
                  </span>
                  {c.reason ? <span className="text-secondary">{c.reason}</span> : null}
                </li>
              ))}
            </ol>
          </Section>
        </aside>
      </div>
    </>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-secondary">{label}</dt>
      <dd className={`tabular ${strong ? "text-text font-semibold" : "text-text"}`}>{value}</dd>
    </div>
  );
}
