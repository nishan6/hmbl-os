import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, Wallet } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { claimsAwaitingApproval, listMyClaims } from "@/server/expenses/claims";
import { can } from "@/server/permissions/authorize";
import { formatDate, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CLAIM_STATUS } from "../finance/_components/status";

export const metadata = { title: "Expenses" };

export default async function ExpensesPage() {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "expenses.view")) notFound();
  const [claims, awaiting] = await Promise.all([
    listMyClaims(actor),
    claimsAwaitingApproval(actor),
  ]);
  return (
    <>
      <PageHeader
        title="Expenses"
        description="Claim back what you spent for work, with receipts. Your project manager or Finance approves, and Finance pays or sets it against your advance."
        actions={
          can(actor, "expenses.create") ? (
            <Button asChild variant="primary">
              <Link href="/expenses/new">
                <Plus aria-hidden />
                New claim
              </Link>
            </Button>
          ) : null
        }
      />
      {awaiting.length ? (
        <Section title="Awaiting your approval">
          <Table dense>
            <THead>
              <tr>
                <TH>Number</TH>
                <TH>Claimant</TH>
                <TH>Title</TH>
                <TH>Submitted</TH>
                <TH align="right">Total</TH>
              </tr>
            </THead>
            <TBody>
              {awaiting.map((c) => (
                <TR key={c.id}>
                  <TD className="tabular whitespace-nowrap">
                    <Link href={`/expenses/${c.id}`} className="text-accent hover:underline">
                      {c.number}
                    </Link>
                  </TD>
                  <TD>{c.claimant.name}</TD>
                  <TD>{c.title}</TD>
                  <TD className="tabular text-secondary">
                    {c.submittedAt ? formatDate(c.submittedAt, "Asia/Kolkata") : ""}
                  </TD>
                  <TD align="right">{formatMoney(c.totalMinor, c.currency)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      ) : null}
      <Section title="Your claims">
        {claims.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Number</TH>
                <TH>Title</TH>
                <TH>Company</TH>
                <TH>Status</TH>
                <TH align="right">Total</TH>
                <TH align="right">Still owed to you</TH>
              </tr>
            </THead>
            <TBody>
              {claims.map((c) => (
                <TR key={c.id}>
                  <TD className="tabular whitespace-nowrap">
                    <Link href={`/expenses/${c.id}`} className="text-accent hover:underline">
                      {c.number ?? "Draft"}
                    </Link>
                  </TD>
                  <TD>{c.title}</TD>
                  <TD className="text-secondary">{c.legalEntity.code}</TD>
                  <TD>
                    <StatusBadge status={CLAIM_STATUS[c.status]} />
                    {c.status === "APPROVED" && c.outstandingMinor === 0n ? (
                      <>
                        {" "}
                        <StatusBadge status="paid" />
                      </>
                    ) : null}
                  </TD>
                  <TD align="right">{formatMoney(c.totalMinor, c.currency)}</TD>
                  <TD align="right">
                    {c.outstandingMinor ? formatMoney(c.outstandingMinor, c.currency) : ""}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState
            icon={Wallet}
            title="No claims yet"
            description="Start a claim for a trip or a site visit, and add each expense with its receipt."
          />
        )}
      </Section>
    </>
  );
}
