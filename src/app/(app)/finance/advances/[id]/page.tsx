import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { getAdvance } from "@/server/finance/advances";
import { moneyAccountOptions } from "@/server/finance/bank-accounts";
import { financeEntity } from "@/server/finance/context";
import { PAYMENT_METHODS } from "@/server/finance/receipts";
import { AppError } from "@/lib/errors";
import { toDateOnly } from "@/lib/fiscal";
import { formatDate, formatMoney } from "@/lib/format";
import { minorToInput } from "@/lib/money";
import { Alert, DetailList, Panel, Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "../../_components/finance-header";
import { ADVANCE_STATUS } from "../../_components/status";
import { VoidForm } from "../../_components/void-form";
import { returnAdvanceAction, voidAdvanceAction } from "../actions";
import { ReturnAdvanceForm } from "./return-form";

export const metadata = { title: "Advance" };

export default async function AdvancePage({ params }: PageProps<"/finance/advances/[id]">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const advance = await getAdvance(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const { entities, entity } = await financeEntity(actor, advance.legalEntityId);
  if (!entity) notFound();
  const money = (minor: bigint) => formatMoney(minor, advance.currency);
  const today = toDateOnly(new Date());
  const accounts = advance.actions.return
    ? (await moneyAccountOptions(actor, advance.legalEntityId)).filter(
        (a) => a.currency === advance.currency,
      )
    : [];
  const history = [
    ...advance.settlements.map((s) => ({
      id: s.id,
      date: s.date,
      what: (
        <>
          Expense claim{" "}
          <Link href={`/expenses/${s.claim.id}`} className="text-accent hover:underline">
            {s.claim.number}
          </Link>{" "}
          · {s.claim.title}
          {s.voidedAt ? (
            <>
              {" "}
              <StatusBadge status="voided" />
            </>
          ) : null}
        </>
      ),
      amountMinor: s.amountMinor,
    })),
    ...advance.returns.map((r) => ({
      id: r.id,
      date: r.date,
      what: (
        <>
          Returned to {r.depositAccount.code} · {r.depositAccount.name}
          {r.reference ? ` (${r.reference})` : ""}
        </>
      ),
      amountMinor: r.amountMinor,
    })),
  ].sort((a, b) => a.date.getTime() - b.date.getTime());

  return (
    <>
      <FinanceHeader
        title={`Advance ${advance.number}`}
        description={<StatusBadge status={ADVANCE_STATUS[advance.status]} />}
        entity={entity}
        entities={entities}
        crumbs={[
          { label: "Advances", href: withEntity("/finance/advances", entity) },
          { label: advance.number },
        ]}
      />
      {advance.status === "VOIDED" ? (
        <div className="mb-6">
          <Alert tone="warning" title="Voided">
            Voided on {formatDate(advance.voidDate!, "UTC")}: {advance.voidReason}. Its journal was
            reversed.
          </Alert>
        </div>
      ) : null}
      <Section title="Details">
        <DetailList
          items={[
            { label: "Paid to", value: advance.person.name },
            { label: "Purpose", value: advance.purpose },
            ...(advance.project
              ? [
                  {
                    label: "Project",
                    value: (
                      <Link
                        href={`/projects/${advance.project.id}`}
                        className="text-accent hover:underline"
                      >
                        {advance.project.number} · {advance.project.name}
                      </Link>
                    ),
                  },
                ]
              : []),
            { label: "Date", value: formatDate(advance.date, "UTC") },
            {
              label: "Paid from",
              value: `${advance.paidFrom.code} · ${advance.paidFrom.name} by ${PAYMENT_METHODS[advance.method]}${advance.reference ? ` (${advance.reference})` : ""}`,
            },
            {
              label: "Amount",
              value: <span className="tabular">{money(advance.amountMinor)}</span>,
            },
            {
              label: "Settled by claims",
              value: <span className="tabular">{money(advance.settledMinor)}</span>,
            },
            {
              label: "Returned",
              value: <span className="tabular">{money(advance.returnedMinor)}</span>,
            },
            {
              label: "Left",
              value: <span className="tabular">{money(advance.outstandingMinor)}</span>,
            },
            {
              label: "Ledger",
              value: (
                <Link
                  href={`/finance/journals/${advance.journalId}`}
                  className="text-accent hover:underline"
                >
                  Advance journal
                </Link>
              ),
            },
          ]}
        />
      </Section>
      <Section title="Cleared by">
        {history.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>What</TH>
                <TH align="right">Amount</TH>
              </tr>
            </THead>
            <TBody>
              {history.map((h) => (
                <TR key={h.id}>
                  <TD className="tabular text-secondary">{formatDate(h.date, "UTC")}</TD>
                  <TD>{h.what}</TD>
                  <TD align="right">{money(h.amountMinor)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-secondary text-sm">
            Nothing yet. Settle the person&apos;s approved expense claims from this advance.
          </p>
        )}
      </Section>
      {advance.actions.return ? (
        <Section title="Money handed back" description="Unspent money returned by the person.">
          <Panel>
            <ReturnAdvanceForm
              action={returnAdvanceAction.bind(null, advance.id)}
              accounts={accounts}
              currency={advance.currency}
              defaults={{
                date: today,
                depositAccountId: advance.paidFromId,
                amount: minorToInput(advance.outstandingMinor, advance.currency),
              }}
            />
          </Panel>
        </Section>
      ) : null}
      {advance.actions.void ? (
        <Section
          title="Void"
          description="For an advance recorded in error, before any of it is settled or returned."
        >
          <Panel>
            <VoidForm
              action={voidAdvanceAction.bind(null, advance.id)}
              defaultDate={today}
              confirm="Void this advance? Its journal is reversed."
              label="Void advance"
              failure="The advance wasn't voided"
            />
          </Panel>
        </Section>
      ) : null}
    </>
  );
}
