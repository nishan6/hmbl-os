import Link from "next/link";
import { HandCoins, Plus } from "lucide-react";
import { can } from "@/server/permissions/authorize";
import { listAdvances } from "@/server/finance/advances";
import { formatDate, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "../_components/finance-header";
import { loadFinancePage, param } from "../_components/load";
import { ADVANCE_STATUS } from "../_components/status";

export const metadata = { title: "Advances" };

export default async function AdvancesPage({ searchParams }: PageProps<"/finance/advances">) {
  const { actor, params, entities, entity } = await loadFinancePage(searchParams);
  const openOnly = param(params.open) === "1";
  const advances = await listAdvances(actor, { legalEntityId: entity.id, openOnly });
  return (
    <>
      <FinanceHeader
        title="Advances"
        description="Money given to staff and crew ahead of spending, cleared by their expense claims and by handing back what is left."
        entity={entity}
        entities={entities}
        current="/finance/advances"
        actions={
          can(actor, "finance.post", { legalEntityId: entity.id }) ? (
            <Button asChild variant="primary">
              <Link href={withEntity("/finance/advances/new", entity)}>
                <Plus aria-hidden />
                Pay an advance
              </Link>
            </Button>
          ) : null
        }
      />
      <p className="mb-4 text-sm">
        {openOnly ? (
          <Link href={withEntity("/finance/advances", entity)} className="text-accent underline">
            Show all advances
          </Link>
        ) : (
          <Link
            href={withEntity("/finance/advances?open=1", entity)}
            className="text-accent underline"
          >
            Show only advances with money left
          </Link>
        )}
      </p>
      {advances.length ? (
        <Table dense>
          <THead>
            <tr>
              <TH>Date</TH>
              <TH>Number</TH>
              <TH>Person</TH>
              <TH>Purpose</TH>
              <TH>Status</TH>
              <TH align="right">Paid</TH>
              <TH align="right">Left</TH>
            </tr>
          </THead>
          <TBody>
            {advances.map((a) => (
              <TR key={a.id}>
                <TD className="tabular text-secondary whitespace-nowrap">
                  {formatDate(a.date, "UTC")}
                </TD>
                <TD className="tabular whitespace-nowrap">
                  <Link href={`/finance/advances/${a.id}`} className="text-accent hover:underline">
                    {a.number}
                  </Link>
                </TD>
                <TD>{a.person.name}</TD>
                <TD>
                  {a.purpose}
                  {a.project ? (
                    <span className="text-muted tabular block text-xs">{a.project.number}</span>
                  ) : null}
                </TD>
                <TD>
                  <StatusBadge status={ADVANCE_STATUS[a.status]} />
                </TD>
                <TD align="right">{formatMoney(a.amountMinor, a.currency)}</TD>
                <TD align="right">
                  {a.outstandingMinor ? formatMoney(a.outstandingMinor, a.currency) : ""}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState
          icon={HandCoins}
          title={openOnly ? "No advances with money left" : "No advances yet"}
          description="Pay an advance before a trip or a load-in; it is cleared by the person's expense claims."
        />
      )}
    </>
  );
}
