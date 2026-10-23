import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck, CircleX, TriangleAlert } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { financeEntity } from "@/server/finance/context";
import { getPeriodClose, type CheckState } from "@/server/finance/period-close";
import { can } from "@/server/permissions/authorize";
import { AppError } from "@/lib/errors";
import { toDateOnly } from "@/lib/fiscal";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Alert, Panel, Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "../../_components/finance-header";
import { closePeriodAction, reopenPeriodAction } from "../actions";
import { ClosePeriodForm, ReopenPeriodForm } from "./period-forms";

export const metadata = { title: "Period close" };

const STATE: Record<CheckState, { label: string; icon: typeof CircleCheck; tone: string }> = {
  ok: { label: "Done", icon: CircleCheck, tone: "text-success" },
  warning: { label: "Warning", icon: TriangleAlert, tone: "text-warning" },
  blocking: { label: "Must clear", icon: CircleX, tone: "text-danger" },
};

type Evidence = { key: string; label: string; state: CheckState; detail: string }[];

export default async function PeriodPage({ params }: PageProps<"/finance/periods/[id]">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const close = await getPeriodClose(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const { period, checks } = close;
  const { entities, entity } = await financeEntity(actor, period.legalEntityId);
  if (!entity) notFound();
  const warnings = checks?.filter((c) => c.state === "warning").length ?? 0;
  const blocking = checks?.filter((c) => c.state === "blocking").length ?? 0;
  const adjust = can(actor, "finance.create", { legalEntityId: entity.id });

  return (
    <>
      <FinanceHeader
        title={period.name}
        description={
          <span className="inline-flex items-center gap-2">
            <StatusBadge status={period.status === "CLOSED" ? "closed" : "open"} />
            {formatDate(period.startDate, "UTC")} – {formatDate(period.endDate, "UTC")} · Financial
            year {period.fiscalYear}
          </span>
        }
        entity={entity}
        entities={entities}
        crumbs={[
          { label: "Period close", href: withEntity("/finance/periods", entity) },
          { label: period.name },
        ]}
        actions={
          period.status === "OPEN" && adjust ? (
            <Button asChild>
              <Link
                href={withEntity(
                  `/finance/journals/new?date=${toDateOnly(period.endDate)}&narration=${encodeURIComponent(`Adjustment for ${period.name}`)}`,
                  entity,
                )}
              >
                New adjustment journal
              </Link>
            </Button>
          ) : null
        }
      />
      {checks ? (
        <Section
          title="Close checklist"
          description="Worked out from the books now. Clear what must be cleared; warnings can be accepted with a note."
        >
          <ul className="border-separator bg-surface divide-separator divide-y rounded-lg border shadow-sm">
            {checks.map((c) => {
              const s = STATE[c.state];
              return (
                <li key={c.key} className="flex items-start gap-3 px-4 py-3">
                  <s.icon className={cn("mt-0.5 size-4 shrink-0", s.tone)} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-text text-sm font-medium">
                      {c.label}
                      <span className={cn("ml-2 text-xs", s.tone)}>{s.label}</span>
                    </p>
                    <p className="text-secondary text-sm">{c.detail}</p>
                  </div>
                  {c.href && c.state !== "ok" ? (
                    <Link
                      href={withEntity(c.href, entity)}
                      className="text-accent shrink-0 text-sm hover:underline"
                    >
                      Open
                    </Link>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      {period.status === "OPEN" ? (
        <Section title="Close the period">
          <Panel>
            {blocking ? (
              <Alert
                tone="warning"
                title={`Clear ${blocking === 1 ? "the item" : `the ${blocking} items`} marked “Must clear” first`}
              />
            ) : close.canClose ? (
              <ClosePeriodForm
                action={closePeriodAction.bind(null, period.id)}
                name={period.name}
                warnings={warnings}
              />
            ) : (
              <p className="text-secondary text-sm">
                Closing a period needs Finance approval rights.
              </p>
            )}
          </Panel>
        </Section>
      ) : close.canReopen ? (
        <Section
          title="Reopen the period"
          description="For a correction that must be dated in this month. Close it again afterwards."
        >
          <Panel>
            <ReopenPeriodForm
              action={reopenPeriodAction.bind(null, period.id)}
              name={period.name}
            />
          </Panel>
        </Section>
      ) : null}

      <Section title="History">
        {close.events.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>When</TH>
                <TH>What</TH>
                <TH>By</TH>
                <TH>Note</TH>
                <TH>Checklist at the time</TH>
              </tr>
            </THead>
            <TBody>
              {close.events.map((e) => (
                <TR key={e.id}>
                  <TD className="tabular whitespace-nowrap">{formatDateTime(e.createdAt)}</TD>
                  <TD>{e.action === "CLOSED" ? "Closed" : "Reopened"}</TD>
                  <TD>{close.people.get(e.actorId) ?? "—"}</TD>
                  <TD className="text-secondary">{e.note ?? "—"}</TD>
                  <TD className="text-secondary">
                    {Array.isArray(e.evidence)
                      ? (e.evidence as Evidence)
                          .filter((c) => c.state !== "ok")
                          .map((c) => `${c.label}: ${c.detail}`)
                          .join("; ") || "All done"
                      : "—"}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-secondary text-sm">Never closed.</p>
        )}
      </Section>
    </>
  );
}
