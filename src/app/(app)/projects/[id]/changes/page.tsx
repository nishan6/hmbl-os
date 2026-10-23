import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { getProject } from "@/server/projects/projects";
import { changeOrderLabel, listChangeOrders } from "@/server/projects/change-orders";
import { isLocked, isPreApproval } from "@/server/projects/lifecycle";
import { AppError } from "@/lib/errors";
import { formatDateTime, formatMoney } from "@/lib/format";
import { Alert, EmptyState, Panel, Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ProjectHeader } from "../../_components/project-header";
import { CHANGE_ORDER_STATUS } from "../../_components/status";
import { createChangeOrderAction } from "./actions";
import { ChangeDetailsForm } from "./change-forms";

export const metadata = { title: "Change orders" };

export default async function ChangeOrdersPage({ params }: PageProps<"/projects/[id]/changes">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const [p, { showCosts, orders, versions }] = await Promise.all([
    getProject(actor, id),
    listChangeOrders(actor, id),
  ]).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const money = (minor: bigint) => formatMoney(minor, p.currency);
  const approved = !isPreApproval(p.status) && p.baselineLockedAt;
  const canCreate =
    approved &&
    !isLocked(p.status) &&
    can(actor, "projects.edit", { legalEntityId: p.legalEntityId });

  return (
    <>
      <ProjectHeader project={p} current="/changes" showCosts={showCosts} />

      {approved ? null : (
        <div className="mb-6">
          <Alert tone="info" title="Not approved yet">
            Change orders start once the Director approves the project. Until then, edit the draft
            budget directly.
          </Alert>
        </div>
      )}

      <Section
        title="Change orders"
        description="Every change to the approved budget, with its reason and who approved it."
      >
        {orders.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Change</TH>
                <TH>Status</TH>
                {showCosts ? <TH align="right">Cost change</TH> : null}
                <TH align="right">Revenue change</TH>
                <TH>Raised by</TH>
              </tr>
            </THead>
            <TBody>
              {orders.map((o) => (
                <TR key={o.id}>
                  <TD className="py-1.5">
                    <Link
                      href={`/projects/${p.id}/changes/${o.id}`}
                      className="text-accent hover:underline"
                    >
                      {changeOrderLabel(o.number)} · {o.title}
                    </Link>
                  </TD>
                  <TD>
                    <StatusBadge status={CHANGE_ORDER_STATUS[o.status]} />
                  </TD>
                  {showCosts ? <TD align="right">{money(o.costDeltaMinor ?? 0n)}</TD> : null}
                  <TD align="right">{money(o.revenueDeltaMinor)}</TD>
                  <TD className="text-secondary">{o.createdBy.name}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState
            title="No change orders"
            description={canCreate ? "Raise one below when the scope or budget moves." : undefined}
          />
        )}
        {canCreate ? (
          <Panel className="mt-4">
            <h3 className="text-text mb-3 text-sm font-semibold">Raise a change order</h3>
            <ChangeDetailsForm
              action={createChangeOrderAction.bind(null, p.id)}
              submitLabel="Create draft"
            />
          </Panel>
        ) : null}
      </Section>

      {versions.length ? (
        <Section
          title="Budget versions"
          description="Version 1 is the original approved budget. Each approved change order adds a version."
        >
          <Table dense>
            <THead>
              <tr>
                <TH>Version</TH>
                <TH>Source</TH>
                {showCosts ? <TH align="right">Budget cost</TH> : null}
                <TH align="right">Expected revenue</TH>
                <TH>Recorded</TH>
              </tr>
            </THead>
            <TBody>
              {versions.map((v) => (
                <TR key={v.id}>
                  <TD className="tabular">v{v.version}</TD>
                  <TD>
                    {v.changeOrder ? (
                      <Link
                        href={`/projects/${p.id}/changes/${v.changeOrder.id}`}
                        className="text-accent hover:underline"
                      >
                        {changeOrderLabel(v.changeOrder.number)} · {v.changeOrder.title}
                      </Link>
                    ) : (
                      "Original budget"
                    )}
                  </TD>
                  {showCosts ? <TD align="right">{money(v.costMinor ?? 0n)}</TD> : null}
                  <TD align="right">{money(v.revenueMinor)}</TD>
                  <TD className="text-secondary">
                    {v.createdByLabel} · {formatDateTime(v.createdAt, p.legalEntity.timezone)}
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
