import { notFound } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { getProject } from "@/server/projects/projects";
import { getProjectBudget } from "@/server/projects/budget";
import { listCostCodes } from "@/server/projects/cost-codes";
import { isLocked, isPreApproval } from "@/server/projects/lifecycle";
import { LINE_CATEGORIES } from "@/server/commercial/schemas";
import { localToday } from "@/server/commercial/quotes";
import { AppError } from "@/lib/errors";
import { formatDate, formatMoney } from "@/lib/format";
import { minorToInput } from "@/lib/money";
import { formatBps } from "@/lib/percent";
import type { LineFigures } from "@/lib/budget";
import { ActionButton } from "@/components/ui/action-button";
import { Alert, EmptyState, Panel, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ProjectHeader } from "../../_components/project-header";
import {
  costEntryCommandAction,
  deleteDraftLineAction,
  lineSettingsAction,
  recordCostAction,
  saveDraftLineAction,
} from "./actions";
import { CostEntryForm, DraftLineForm, LineSettingsForm, VoidEntryForm } from "./budget-forms";

export const metadata = { title: "Project budget" };

export default async function ProjectBudgetPage({ params }: PageProps<"/projects/[id]/budget">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const [p, budget] = await Promise.all([getProject(actor, id), getProjectBudget(actor, id)]).catch(
    (error: unknown) => {
      // Not found, or not allowed to see costs: either way, no budget page.
      if (error instanceof AppError) notFound();
      throw error;
    },
  );
  const costCodes = (await listCostCodes(actor)).map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    category: c.category,
  }));
  const canEdit =
    can(actor, "projects.edit", { legalEntityId: p.legalEntityId }) && !isLocked(p.status);
  const draft = isPreApproval(p.status) && !p.baselineLockedAt;
  const money = (minor: bigint) => formatMoney(minor, p.currency);
  const { totals, profit } = budget;
  const openCommitments = budget.entries.filter(
    (e) => e.kind === "COMMITMENT" && !e.closedAt && !e.voidedAt,
  );

  return (
    <>
      <ProjectHeader project={p} current="/budget" showCosts />

      {draft ? (
        <div className="mb-6">
          <Alert tone="info" title="Draft budget">
            Build the budget here. It becomes the original approved budget when the Director
            approves the project, and changes after that go through change orders.
          </Alert>
        </div>
      ) : null}

      {budget.integrity.length ? (
        <div className="mb-6">
          <Alert tone="danger" title="The budget records don't agree">
            <ul className="list-disc pl-4">
              {budget.integrity.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
            <p className="mt-1">Nothing has been changed. Tell your administrator.</p>
          </Alert>
        </div>
      ) : null}

      <Section title="Summary" description="Amounts before tax, in the project's currency.">
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel>
            <h3 className="text-text mb-3 text-sm font-semibold">Cost</h3>
            <dl className="flex flex-col gap-2 text-base">
              <Figure label="Original budget" value={money(totals.originalMinor)} />
              <Figure label="Approved changes" value={money(totals.changesMinor)} />
              <Figure label="Revised budget" value={money(totals.revisedMinor)} strong />
              <Figure label="Committed" value={money(totals.committedMinor)} />
              <Figure label="Actual" value={money(totals.actualMinor)} />
              <Figure label="Remaining" value={money(totals.remainingMinor)} />
              <Figure label="Forecast at completion" value={money(totals.forecastMinor)} strong />
              <Figure label="Variance" value={<Variance figures={totals} money={money} />} />
            </dl>
          </Panel>
          <Panel>
            <h3 className="text-text mb-3 text-sm font-semibold">Revenue and profit</h3>
            <dl className="flex flex-col gap-2 text-base">
              <Figure label="Expected revenue" value={money(profit.expectedRevenueMinor)} strong />
              <Figure label="Invoiced" value={<span className="text-muted">With Finance</span>} />
              <Figure label="Collected" value={<span className="text-muted">With Finance</span>} />
              <Figure label="Estimated gross profit" value={money(profit.grossProfitMinor)} />
              <Figure
                label="Estimated gross margin"
                value={profit.marginBps === null ? "—" : formatBps(profit.marginBps)}
              />
            </dl>
            <p className="text-muted mt-3 text-xs">
              Profit is expected revenue less the forecast cost. Invoicing and receipts come with
              Finance.
            </p>
          </Panel>
        </div>
      </Section>

      <Section title="Budget lines">
        {budget.rows.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Line</TH>
                <TH align="right">Original</TH>
                <TH align="right">Changes</TH>
                <TH align="right">Revised</TH>
                <TH align="right">Committed</TH>
                <TH align="right">Actual</TH>
                <TH align="right">Forecast</TH>
                <TH align="right">Variance</TH>
              </tr>
            </THead>
            {budget.categories.map((c) => (
              <TBody key={c.category}>
                <tr className="bg-surface-2">
                  <th
                    scope="rowgroup"
                    className="text-text px-3 py-1.5 text-left text-sm font-semibold"
                  >
                    {LINE_CATEGORIES[c.category]}
                  </th>
                  <FigureCells figures={c.figures} money={money} strong />
                </tr>
                {c.rows.map(({ line, figures }) => (
                  <TR key={line.id}>
                    <TD className="min-w-64 py-1.5">
                      {line.section ? <p className="text-muted text-xs">{line.section}</p> : null}
                      <span className="flex flex-wrap items-center gap-1.5">
                        {line.description}
                        {line.costCode ? <Tag>{line.costCode.code}</Tag> : null}
                        {line.forecastCostMinor !== null ? <Tag tone="info">Estimate</Tag> : null}
                      </span>
                      {line.forecastNote ? (
                        <p className="text-secondary text-xs">{line.forecastNote}</p>
                      ) : null}
                      {canEdit ? (
                        <details className="text-sm">
                          <summary className="text-accent cursor-pointer text-xs">
                            {draft ? "Edit" : "Cost code and estimate"}
                            <span className="sr-only"> for {line.description}</span>
                          </summary>
                          {draft ? (
                            <div className="py-2">
                              <DraftLineForm
                                action={saveDraftLineAction.bind(null, p.id)}
                                costCodes={costCodes}
                                submitLabel="Save line"
                                defaults={{
                                  lineId: line.id,
                                  description: line.description,
                                  section: line.section ?? "",
                                  category: line.category,
                                  costCodeId: line.costCodeId ?? "",
                                  quantity: line.quantity.toString(),
                                  days: line.days.toString(),
                                  cost: minorToInput(line.costMinor, p.currency),
                                  revenue: minorToInput(line.revenueMinor, p.currency),
                                }}
                              />
                              <div className="mt-2">
                                <ActionButton
                                  action={deleteDraftLineAction.bind(null, p.id)}
                                  fields={{ lineId: line.id }}
                                  confirm="Remove this line from the draft budget?"
                                >
                                  Remove line
                                </ActionButton>
                              </div>
                            </div>
                          ) : (
                            <LineSettingsForm
                              action={lineSettingsAction.bind(null, line.id)}
                              costCodes={costCodes}
                              category={line.category}
                              lineLabel={line.description}
                              defaults={{
                                costCodeId: line.costCodeId ?? "",
                                forecast:
                                  line.forecastCostMinor === null
                                    ? ""
                                    : minorToInput(line.forecastCostMinor, p.currency),
                                note: line.forecastNote ?? "",
                              }}
                            />
                          )}
                        </details>
                      ) : null}
                    </TD>
                    <FigureCells figures={figures} money={money} />
                  </TR>
                ))}
              </TBody>
            ))}
            <TBody>
              <tr className="bg-surface-2">
                <th scope="row" className="text-text px-3 py-2 text-left text-sm font-semibold">
                  Total
                </th>
                <FigureCells figures={totals} money={money} strong />
              </tr>
            </TBody>
          </Table>
        ) : (
          <EmptyState
            title="No budget lines yet"
            description={draft ? "Add the costs you expect below." : undefined}
          />
        )}
        {canEdit && draft ? (
          <Panel className="mt-4">
            <h3 className="text-text mb-3 text-sm font-semibold">Add a budget line</h3>
            <DraftLineForm action={saveDraftLineAction.bind(null, p.id)} costCodes={costCodes} />
          </Panel>
        ) : null}
      </Section>

      {!draft ? (
        <Section
          title="Committed and actual costs"
          description="Entered by hand until purchase orders, vendor bills and expenses come with Finance. Entries are never edited; void a mistake and enter it again."
        >
          {canEdit && budget.rows.length ? (
            <Panel className="mb-4">
              <h3 className="text-text mb-3 text-sm font-semibold">Record a cost</h3>
              <CostEntryForm
                action={recordCostAction.bind(null, p.id)}
                today={localToday(p.legalEntity.timezone).toISOString().slice(0, 10)}
                lines={budget.rows.map(({ line }) => ({
                  id: line.id,
                  label: `${LINE_CATEGORIES[line.category]} · ${line.description}`,
                }))}
                commitments={openCommitments.map((c) => ({
                  id: c.id,
                  lineId: c.budgetLineId,
                  label: `${c.reference ? `${c.reference} · ` : ""}${c.description} (${money(c.amountMinor)})`,
                }))}
              />
            </Panel>
          ) : null}
          {budget.entries.length ? (
            <Table dense>
              <THead>
                <tr>
                  <TH>Date</TH>
                  <TH>Entry</TH>
                  <TH>Line</TH>
                  <TH>Type</TH>
                  <TH align="right">Amount</TH>
                  {canEdit ? <TH>Actions</TH> : null}
                </tr>
              </THead>
              <TBody>
                {budget.entries.map((e) => (
                  <TR key={e.id} className={e.voidedAt ? "text-muted" : undefined}>
                    <TD className="tabular whitespace-nowrap">{formatDate(e.entryDate, "UTC")}</TD>
                    <TD className="py-1.5">
                      <span className={e.voidedAt ? "line-through" : undefined}>
                        {e.description}
                      </span>
                      <p className="text-muted text-xs">
                        {[e.supplier, e.reference, e.createdBy.name].filter(Boolean).join(" · ")}
                      </p>
                      {e.commitment ? (
                        <p className="text-secondary text-xs">
                          Against {e.commitment.reference ?? e.commitment.description}
                        </p>
                      ) : null}
                      {e.voidReason ? (
                        <p className="text-secondary text-xs">Void: {e.voidReason}</p>
                      ) : null}
                    </TD>
                    <TD className="text-secondary">{e.budgetLine.description}</TD>
                    <TD>
                      <span className="flex flex-wrap items-center gap-1.5">
                        {e.kind === "COMMITMENT" ? "Committed" : "Actual"}
                        {e.voidedAt ? (
                          <StatusBadge status="voided" />
                        ) : e.closedAt ? (
                          <StatusBadge status="closed" />
                        ) : null}
                      </span>
                    </TD>
                    <TD align="right" className={e.voidedAt ? "line-through" : undefined}>
                      {money(e.amountMinor)}
                    </TD>
                    {canEdit ? (
                      <TD>
                        {e.voidedAt ? null : (
                          <div className="flex flex-col items-start gap-1">
                            {e.kind === "COMMITMENT" && !e.closedAt ? (
                              <ActionButton
                                action={costEntryCommandAction}
                                fields={{ entryId: e.id, command: "close" }}
                                confirm="Nothing more will be billed against this commitment. Release what's left?"
                              >
                                Close<span className="sr-only"> {e.description}</span>
                              </ActionButton>
                            ) : null}
                            <details className="text-sm">
                              <summary className="text-secondary hover:text-text cursor-pointer px-2.5 text-sm">
                                Void<span className="sr-only"> {e.description}</span>
                              </summary>
                              <VoidEntryForm action={costEntryCommandAction} entryId={e.id} />
                            </details>
                          </div>
                        )}
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="text-secondary text-sm">No costs recorded yet.</p>
          )}
        </Section>
      ) : null}
    </>
  );
}

function Figure({
  label,
  value,
  strong,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-secondary">{label}</dt>
      <dd className={`tabular ${strong ? "text-text font-semibold" : "text-text"}`}>{value}</dd>
    </div>
  );
}

/** Variance with an icon and words when it's an overrun, never colour alone. */
function Variance({ figures, money }: { figures: LineFigures; money: (m: bigint) => string }) {
  if (figures.varianceMinor >= 0n) return <>{money(figures.varianceMinor)}</>;
  return (
    <span className="text-danger inline-flex items-center gap-1">
      <TriangleAlert className="size-3.5" aria-hidden />
      {money(figures.varianceMinor)}
      <span className="sr-only"> over budget</span>
    </span>
  );
}

function FigureCells({
  figures,
  money,
  strong,
}: {
  figures: LineFigures;
  money: (m: bigint) => string;
  strong?: boolean;
}) {
  const cls = strong ? "font-semibold" : undefined;
  return (
    <>
      <TD align="right" className={cls}>
        {money(figures.originalMinor)}
      </TD>
      <TD align="right" className={cls}>
        {money(figures.changesMinor)}
      </TD>
      <TD align="right" className={cls}>
        {money(figures.revisedMinor)}
      </TD>
      <TD align="right" className={cls}>
        {money(figures.committedMinor)}
      </TD>
      <TD align="right" className={cls}>
        {money(figures.actualMinor)}
      </TD>
      <TD align="right" className={cls}>
        {money(figures.forecastMinor)}
      </TD>
      <TD align="right" className={cls}>
        <Variance figures={figures} money={money} />
      </TD>
    </>
  );
}
