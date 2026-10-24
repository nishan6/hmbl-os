import Link from "next/link";
import { notFound } from "next/navigation";
import { Paperclip } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { getClaim } from "@/server/expenses/claims";
import { settlementOptions } from "@/server/finance/expense-settlements";
import { can } from "@/server/permissions/authorize";
import { AppError } from "@/lib/errors";
import { toDateOnly } from "@/lib/fiscal";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { minorToInput } from "@/lib/money";
import { ActionButton } from "@/components/ui/action-button";
import { Button } from "@/components/ui/button";
import { Alert, DetailList, PageHeader, Panel, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CLAIM_STATUS } from "../../finance/_components/status";
import { VoidForm } from "../../finance/_components/void-form";
import {
  claimCommandAction,
  rejectClaimAction,
  settleClaimAction,
  voidClaimAction,
  voidSettlementAction,
} from "../actions";
import { ReceiptUploadForm, RejectClaimForm, SettleClaimForm } from "./claim-forms";

export const metadata = { title: "Expense claim" };

export default async function ClaimPage({ params }: PageProps<"/expenses/[id]">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const claim = await getClaim(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const money = (minor: bigint) => formatMoney(minor, claim.currency);
  const command = claimCommandAction.bind(null, claim.id);
  const books = can(actor, "finance.view", { legalEntityId: claim.legalEntityId });
  const settle = claim.actions.settle ? await settlementOptions(actor, claim.id) : null;
  const today = toDateOnly(new Date());
  const budgetLine = (lineId: string | null) =>
    claim.budgetLines.find((b) => b.id === lineId)?.description;
  const receiptsOf = (lineId: string | null) => claim.receipts.filter((r) => r.lineId === lineId);
  const loose = receiptsOf(null);

  return (
    <>
      <PageHeader
        title={claim.number ? `Claim ${claim.number}` : "Draft claim"}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={CLAIM_STATUS[claim.status]} />
            {claim.status === "APPROVED" ? (
              <StatusBadge
                status={
                  claim.outstandingMinor === 0n
                    ? "paid"
                    : claim.settledMinor
                      ? "partially_paid"
                      : "due"
                }
              />
            ) : null}
            <span className="text-muted">
              {claim.title} · {claim.claimant.name} · {claim.legalEntity.code}
            </span>
          </span>
        }
        breadcrumbs={[
          books
            ? {
                label: "Expense claims",
                href: `/finance/expense-claims?entity=${claim.legalEntityId}`,
              }
            : { label: "Expenses", href: "/expenses" },
          { label: claim.number ?? "Draft" },
        ]}
        actions={
          <>
            {claim.actions.edit ? (
              <Button asChild>
                <Link href={`/expenses/${claim.id}/edit`}>Edit</Link>
              </Button>
            ) : null}
            {claim.actions.discard ? (
              <ActionButton
                action={command}
                fields={{ command: "discard" }}
                variant="quiet"
                size="md"
                confirm="Discard this draft claim?"
              >
                Discard
              </ActionButton>
            ) : null}
            {claim.actions.submit ? (
              <ActionButton
                action={command}
                fields={{ command: "submit" }}
                variant="primary"
                size="md"
                pendingLabel="Submitting…"
              >
                Submit for approval
              </ActionButton>
            ) : null}
            {claim.actions.approve ? (
              <ActionButton
                action={command}
                fields={{ command: "approve" }}
                variant="primary"
                size="md"
                pendingLabel="Approving…"
                confirm="Approve this claim? It is posted to the ledger and charged to its projects."
              >
                Approve
              </ActionButton>
            ) : null}
          </>
        }
      />

      {claim.status === "DRAFT" && claim.rejectedReason ? (
        <div className="mb-6">
          <Alert tone="warning" title="Sent back">
            {claim.rejectedReason}
          </Alert>
        </div>
      ) : null}
      {claim.status === "SUBMITTED" ? (
        <div className="mb-6">
          <Alert tone="info" title="Awaiting approval">
            The project manager of every project on this claim approves it, or Finance. Nobody
            approves their own claim.
          </Alert>
        </div>
      ) : null}
      {claim.status === "VOIDED" ? (
        <div className="mb-6">
          <Alert tone="warning" title="Voided">
            Voided on {formatDate(claim.voidDate!, "UTC")}: {claim.voidReason}. Its journal and
            project costs were reversed.
          </Alert>
        </div>
      ) : null}

      <Section title="Details">
        <DetailList
          items={[
            { label: "Claimant", value: claim.claimant.name },
            { label: "Company", value: claim.legalEntity.code },
            { label: "Total", value: <span className="tabular">{money(claim.totalMinor)}</span> },
            ...(claim.status === "APPROVED"
              ? [
                  {
                    label: "Still owed",
                    value: <span className="tabular">{money(claim.outstandingMinor)}</span>,
                  },
                  {
                    label: "Approved",
                    value: formatDateTime(claim.approvedAt!, claim.legalEntity.timezone),
                  },
                  ...(books
                    ? [
                        {
                          label: "Ledger",
                          value: (
                            <Link
                              href={`/finance/journals/${claim.journalId}`}
                              className="text-accent hover:underline"
                            >
                              Claim journal
                            </Link>
                          ),
                        },
                      ]
                    : []),
                ]
              : []),
            ...(claim.notes ? [{ label: "Notes", value: claim.notes }] : []),
          ]}
        />
      </Section>

      <Section title="Expenses">
        {claim.lines.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Expense</TH>
                <TH>Category</TH>
                <TH>Project</TH>
                <TH>Receipts</TH>
                <TH align="right">Amount</TH>
              </tr>
            </THead>
            <TBody>
              {claim.lines.map((l) => (
                <TR key={l.id}>
                  <TD className="tabular text-secondary whitespace-nowrap">
                    {formatDate(l.date, "UTC")}
                  </TD>
                  <TD>
                    {l.description}
                    {l.merchant ? (
                      <span className="text-muted block text-xs">{l.merchant}</span>
                    ) : null}
                    {l.overLimit ? (
                      <span className="mt-1 block">
                        <Tag tone="warning">Over limit</Tag>
                      </span>
                    ) : null}
                    {l.missingReceipt ? (
                      <span className="mt-1 block">
                        <Tag tone="warning">No receipt</Tag>
                      </span>
                    ) : null}
                    {l.policyNote ? (
                      <span className="text-secondary block text-xs">Reason: {l.policyNote}</span>
                    ) : null}
                  </TD>
                  <TD className="text-secondary">
                    {l.category.name}
                    {books ? <span className="tabular block text-xs">{l.account.code}</span> : null}
                  </TD>
                  <TD className="text-secondary">
                    {l.project ? (
                      <>
                        <Link
                          href={`/projects/${l.project.id}`}
                          className="text-accent hover:underline"
                        >
                          {l.project.number}
                        </Link>
                        {budgetLine(l.budgetLineId) ? (
                          <span className="block text-xs">{budgetLine(l.budgetLineId)}</span>
                        ) : null}
                      </>
                    ) : (
                      ""
                    )}
                  </TD>
                  <TD>
                    {receiptsOf(l.id).map((r) => (
                      <a
                        key={r.id}
                        href={`/api/expense-receipts/${r.id}?preview=1`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-accent block text-sm hover:underline"
                      >
                        <Paperclip aria-hidden className="mr-1 inline size-3.5" />
                        {r.fileName}
                      </a>
                    ))}
                  </TD>
                  <TD align="right">
                    {money(l.amountMinor)}
                    {l.spentCurrency && l.spentAmountMinor !== null ? (
                      <span className="text-muted block text-xs">
                        {formatMoney(l.spentAmountMinor, l.spentCurrency)}
                      </span>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-secondary text-sm">No expenses yet. Edit the draft to add them.</p>
        )}
        {loose.length ? (
          <p className="mt-3 text-sm">
            For the whole claim:{" "}
            {loose.map((r, i) => (
              <span key={r.id}>
                {i ? ", " : ""}
                <a
                  href={`/api/expense-receipts/${r.id}?preview=1`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent hover:underline"
                >
                  {r.fileName}
                </a>
              </span>
            ))}
          </p>
        ) : null}
      </Section>

      {claim.actions.attach ? (
        <Section title="Attach a receipt">
          <Panel>
            <ReceiptUploadForm
              claimId={claim.id}
              lines={claim.lines.map((l, i) => ({
                id: l.id,
                label: `${i + 1}. ${l.description} (${money(l.amountMinor)})`,
              }))}
            />
          </Panel>
        </Section>
      ) : null}

      {claim.status === "APPROVED" || claim.settlements.length ? (
        <Section title="Settlement">
          {claim.settlements.length ? (
            <Table dense>
              <THead>
                <tr>
                  <TH>Date</TH>
                  <TH>How</TH>
                  <TH>Reference</TH>
                  <TH align="right">Amount</TH>
                </tr>
              </THead>
              <TBody>
                {claim.settlements.map((s) => (
                  <TR key={s.id}>
                    <TD className="tabular text-secondary">{formatDate(s.date, "UTC")}</TD>
                    <TD>
                      {s.advance ? (
                        books ? (
                          <Link
                            href={`/finance/advances/${s.advance.id}`}
                            className="text-accent hover:underline"
                          >
                            From advance {s.advance.number}
                          </Link>
                        ) : (
                          `From advance ${s.advance.number}`
                        )
                      ) : (
                        `Paid from ${s.paidFrom?.code} · ${s.paidFrom?.name}`
                      )}
                      {s.voidedAt ? (
                        <>
                          {" "}
                          <StatusBadge status="voided" />
                        </>
                      ) : null}
                    </TD>
                    <TD className="tabular">{s.reference}</TD>
                    <TD align="right">{money(s.amountMinor)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="text-secondary text-sm">Nothing settled yet.</p>
          )}
        </Section>
      ) : null}

      {settle ? (
        <Section
          title="Settle"
          description="Set the claim against the claimant's advance, or pay them."
        >
          <Panel>
            <SettleClaimForm
              action={settleClaimAction.bind(null, claim.id)}
              advances={settle.advances}
              accounts={settle.accounts}
              currency={claim.currency}
              outstanding={minorToInput(claim.outstandingMinor, claim.currency)}
              defaultDate={today}
            />
          </Panel>
        </Section>
      ) : null}

      {claim.actions.reject ? (
        <Section title="Send back" description="Return the claim to the claimant to correct.">
          <Panel>
            <RejectClaimForm action={rejectClaimAction.bind(null, claim.id)} />
          </Panel>
        </Section>
      ) : null}

      {claim.actions.voidSettlement && claim.settlements.some((s) => !s.voidedAt) ? (
        <Section
          title="Void a settlement"
          description="For a settlement recorded in error. Its journal is reversed and the claim is owed again."
        >
          {claim.settlements
            .filter((s) => !s.voidedAt)
            .map((s) => (
              <Panel key={s.id} className="mb-3">
                <p className="mb-3 text-sm">
                  {formatDate(s.date, "UTC")} ·{" "}
                  {s.advance ? `advance ${s.advance.number}` : "payment"} ·{" "}
                  <span className="tabular">{money(s.amountMinor)}</span>
                </p>
                <VoidForm
                  action={voidSettlementAction.bind(null, s.id)}
                  defaultDate={today}
                  confirm="Void this settlement? Its journal is reversed."
                  label="Void settlement"
                  failure="The settlement wasn't voided"
                />
              </Panel>
            ))}
        </Section>
      ) : null}

      {claim.actions.void ? (
        <Section
          title="Void"
          description="For a claim approved in error, before anything is settled. The claim stays, marked voided, for the audit trail."
        >
          <Panel>
            <VoidForm
              action={voidClaimAction.bind(null, claim.id)}
              defaultDate={today}
              confirm="Void this claim? Its journal and project costs are reversed."
              label="Void claim"
              failure="The claim wasn't voided"
            />
          </Panel>
        </Section>
      ) : null}
    </>
  );
}
