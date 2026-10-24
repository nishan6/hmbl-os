import { notFound } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { getProject } from "@/server/projects/projects";
import {
  changeOrderActions,
  changeOrderLabel,
  getChangeOrder,
} from "@/server/projects/change-orders";
import { listCostCodes } from "@/server/projects/cost-codes";
import { ACCEPTANCE_METHOD_LABELS, ACCEPTANCE_METHODS } from "@/server/commercial/acceptance";
import { LINE_CATEGORIES } from "@/server/commercial/schemas";
import { AppError } from "@/lib/errors";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { ActionButton } from "@/components/ui/action-button";
import { Alert, DetailList, Panel, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ProjectHeader } from "../../../_components/project-header";
import { CHANGE_ORDER_STATUS } from "../../../_components/status";
import {
  changeOrderCommandAction,
  clientApprovalAction,
  removeChangeLineAction,
  saveChangeLineAction,
  updateChangeOrderAction,
} from "../actions";
import {
  ChangeDetailsForm,
  ChangeLineForm,
  ClientApprovalForm,
  CommandForm,
} from "../change-forms";

export const metadata = { title: "Change order" };

export default async function ChangeOrderPage({
  params,
}: PageProps<"/projects/[id]/changes/[changeId]">) {
  const { id, changeId } = await params;
  const actor = await requireActorOrRedirect();
  const [p, order] = await Promise.all([
    getProject(actor, id),
    getChangeOrder(actor, changeId),
  ]).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  if (order.projectId !== p.id) notFound();
  const { showCosts } = order;
  const allowed = changeOrderActions(actor, order, p);
  const label = changeOrderLabel(order.number);
  const tz = p.legalEntity.timezone;
  const money = (minor: bigint) => formatMoney(minor, p.currency);
  const costCodes = allowed.edit
    ? (await listCostCodes(actor)).map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        category: c.category,
      }))
    : [];
  const methods: Record<string, string> = ACCEPTANCE_METHODS;

  return (
    <>
      <ProjectHeader
        project={p}
        current="/changes"
        showCosts={showCosts}
        crumb={[{ label: "Change orders", href: `/projects/${p.id}/changes` }, { label }]}
      />

      <div className="mb-6 flex flex-col gap-3">
        <h2 className="text-text flex flex-wrap items-center gap-2 text-lg font-semibold">
          {label} · {order.title}
          <StatusBadge status={CHANGE_ORDER_STATUS[order.status]} />
        </h2>
        {allowed.needsClient && order.status === "DRAFT" ? (
          <Alert tone="info" title="Client agreement needed">
            This change alters revenue, so the client&apos;s agreement must be recorded before it
            can be approved.
          </Alert>
        ) : null}
      </div>

      <Section title="Details">
        <Panel>
          <DetailList
            items={[
              {
                label: "Raised by",
                value: `${order.createdBy.name} · ${formatDate(order.createdAt, tz)}`,
              },
              {
                label: order.status === "WITHDRAWN" ? "Withdrawn" : "Approved",
                value: order.decidedAt
                  ? `${order.decidedBy ?? "—"} · ${formatDateTime(order.decidedAt, tz)}`
                  : null,
              },
              {
                label: "Schedule change",
                value:
                  order.scheduleImpactDays === null
                    ? null
                    : `${order.scheduleImpactDays > 0 ? "+" : ""}${order.scheduleImpactDays} days`,
              },
            ]}
          />
          <dl className="mt-4 flex flex-col gap-3 text-base">
            <Text label="Reason" value={order.reason} />
            <Text label="Description" value={order.description} />
            <Text label="Scope impact" value={order.scopeImpact} />
            <Text label="Schedule impact" value={order.scheduleImpact} />
            {order.statusComment ? <Text label="Comment" value={order.statusComment} /> : null}
          </dl>
          {allowed.edit ? (
            <details className="mt-4 text-sm">
              <summary className="text-accent cursor-pointer">Edit details</summary>
              <div className="pt-3">
                <ChangeDetailsForm
                  action={updateChangeOrderAction.bind(null, order.id)}
                  submitLabel="Save details"
                  defaults={{
                    title: order.title,
                    reason: order.reason,
                    description: order.description ?? "",
                    scopeImpact: order.scopeImpact ?? "",
                    scheduleImpact: order.scheduleImpact ?? "",
                    scheduleImpactDays: order.scheduleImpactDays?.toString() ?? "",
                  }}
                />
              </div>
            </details>
          ) : null}
        </Panel>
      </Section>

      <Section
        title="Budget changes"
        description="Amounts before tax. A positive amount adds to the line, a negative one reduces it."
      >
        {order.lines.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Line</TH>
                {showCosts ? <TH align="right">Cost change</TH> : null}
                <TH align="right">Revenue change</TH>
                {allowed.edit ? <TH>Actions</TH> : null}
              </tr>
            </THead>
            <TBody>
              {order.lines.map((l) => {
                const name = l.budgetLine?.description ?? l.newDescription ?? "";
                return (
                  <TR key={l.id}>
                    <TD className="py-1.5">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {name}
                        {l.newDescription ? <Tag tone="info">New line</Tag> : null}
                      </span>
                      <p className="text-muted text-xs">
                        {LINE_CATEGORIES[l.budgetLine?.category ?? l.newCategory!]}
                        {l.note ? ` · ${l.note}` : ""}
                      </p>
                    </TD>
                    {showCosts ? <TD align="right">{money(l.costDeltaMinor ?? 0n)}</TD> : null}
                    <TD align="right">{money(l.revenueDeltaMinor)}</TD>
                    {allowed.edit ? (
                      <TD>
                        <ActionButton
                          action={removeChangeLineAction.bind(null, order.id)}
                          fields={{ lineId: l.id }}
                          confirm="Remove this change?"
                        >
                          Remove<span className="sr-only"> {name}</span>
                        </ActionButton>
                      </TD>
                    ) : null}
                  </TR>
                );
              })}
              <tr className="bg-surface-2">
                <th scope="row" className="text-text px-3 py-2 text-left text-sm font-semibold">
                  Total
                </th>
                {showCosts ? (
                  <TD align="right" className="font-semibold">
                    {money(order.costDeltaMinor ?? 0n)}
                  </TD>
                ) : null}
                <TD align="right" className="font-semibold">
                  {money(order.revenueDeltaMinor)}
                </TD>
                {allowed.edit ? <td /> : null}
              </tr>
            </TBody>
          </Table>
        ) : (
          <p className="text-secondary text-sm">No budget changes yet.</p>
        )}
        {allowed.edit ? (
          <Panel className="mt-4">
            <h3 className="text-text mb-3 text-sm font-semibold">Add a budget change</h3>
            <ChangeLineForm
              action={saveChangeLineAction.bind(null, order.id)}
              lines={order.budgetLines.map((l) => ({
                id: l.id,
                label: `${LINE_CATEGORIES[l.category]} · ${l.description}`,
              }))}
              costCodes={costCodes}
              showCosts={showCosts}
            />
          </Panel>
        ) : null}
      </Section>

      <Section
        title="Client agreement"
        description="Needed before approval when the change alters revenue."
      >
        <Panel>
          {order.clientApprovedOn ? (
            <DetailList
              items={[
                { label: "Agreed on", value: formatDate(order.clientApprovedOn, "UTC") },
                { label: "Agreed by", value: order.clientApprovedByName },
                {
                  label: "How",
                  value: order.clientApprovalMethod
                    ? ACCEPTANCE_METHOD_LABELS[order.clientApprovalMethod]
                    : null,
                },
                { label: "Reference", value: order.clientApprovalReference },
              ]}
            />
          ) : (
            <p className="text-secondary flex items-center gap-1.5 text-sm">
              {allowed.needsClient ? (
                <TriangleAlert className="text-warning size-4" aria-hidden />
              ) : null}
              Not recorded.
            </p>
          )}
          {allowed.clientApproval ? (
            <div className="border-separator mt-4 border-t pt-4">
              <ClientApprovalForm
                action={clientApprovalAction.bind(null, order.id)}
                methods={methods}
                defaults={{
                  clientApprovedOn: order.clientApprovedOn?.toISOString().slice(0, 10) ?? "",
                  clientApprovedByName: order.clientApprovedByName ?? "",
                  clientApprovalMethod: order.clientApprovalMethod ?? "",
                  clientApprovalReference: order.clientApprovalReference ?? "",
                }}
              />
            </div>
          ) : null}
        </Panel>
      </Section>

      {allowed.approve || allowed.withdraw ? (
        <Section title="Next step">
          <div className="grid gap-4 lg:grid-cols-2">
            {allowed.approve ? (
              <Panel>
                <CommandForm
                  action={changeOrderCommandAction.bind(null, order.id)}
                  title="Approve"
                  description="Adds the changes to the revised budget as a new budget version. The change order can't be edited after this."
                  label="Comment"
                  disabled={!order.lines.length || allowed.needsClient}
                  buttons={[{ command: "approve", label: "Approve change", primary: true }]}
                />
              </Panel>
            ) : null}
            {allowed.withdraw ? (
              <Panel>
                <CommandForm
                  action={changeOrderCommandAction.bind(null, order.id)}
                  title="Withdraw"
                  description="The change won't go ahead. It stays on record."
                  label="Reason"
                  required
                  buttons={[{ command: "withdraw", label: "Withdraw change", destructive: true }]}
                />
              </Panel>
            ) : null}
          </div>
        </Section>
      ) : null}
    </>
  );
}

function Text({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <dt className="text-muted text-xs">{label}</dt>
      <dd className="text-text mt-0.5 whitespace-pre-line">{value}</dd>
    </div>
  );
}
