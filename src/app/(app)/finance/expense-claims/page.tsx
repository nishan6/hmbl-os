import Link from "next/link";
import { Search, Wallet } from "lucide-react";
import { CLAIM_STATUSES, listClaims } from "@/server/expenses/claims";
import type { ExpenseClaimStatus } from "@/generated/prisma/enums";
import { formatDate, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader } from "../_components/finance-header";
import { loadFinancePage, param } from "../_components/load";
import { CLAIM_STATUS } from "../_components/status";

export const metadata = { title: "Expense claims" };

export default async function ExpenseClaimsPage({
  searchParams,
}: PageProps<"/finance/expense-claims">) {
  const { actor, params, entities, entity } = await loadFinancePage(searchParams);
  const q = param(params.q) ?? "";
  const status = param(params.status) as ExpenseClaimStatus | undefined;
  const claims = await listClaims(actor, {
    legalEntityId: entity.id,
    search: q,
    status: status && status in CLAIM_STATUSES ? status : undefined,
  });

  return (
    <>
      <FinanceHeader
        title="Expense claims"
        description="Staff and crew claims: approved by the project manager or Finance, then settled from an advance or paid."
        entity={entity}
        entities={entities}
        current="/finance/expense-claims"
      />
      <form role="search" className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="entity" value={entity.id} />
        <label className="sr-only" htmlFor="claim-search">
          Search claims
        </label>
        <Input
          id="claim-search"
          name="q"
          defaultValue={q}
          placeholder="Number, title or claimant"
          className="max-w-xs"
        />
        <label className="sr-only" htmlFor="claim-status">
          Status
        </label>
        <Select id="claim-status" name="status" defaultValue={status ?? ""} className="w-auto">
          <option value="">Submitted and later</option>
          {Object.entries(CLAIM_STATUSES)
            .filter(([value]) => value !== "DRAFT" && value !== "DISCARDED")
            .map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
        </Select>
        <Button type="submit">
          <Search aria-hidden />
          Search
        </Button>
      </form>
      {claims.length ? (
        <Table dense>
          <THead>
            <tr>
              <TH>Submitted</TH>
              <TH>Number</TH>
              <TH>Claimant</TH>
              <TH>Title</TH>
              <TH>Status</TH>
              <TH align="right">Total</TH>
              <TH align="right">Outstanding</TH>
            </tr>
          </THead>
          <TBody>
            {claims.map((c) => (
              <TR key={c.id}>
                <TD className="tabular text-secondary whitespace-nowrap">
                  {c.submittedAt ? formatDate(c.submittedAt, entity.timezone) : ""}
                </TD>
                <TD className="tabular whitespace-nowrap">
                  <Link href={`/expenses/${c.id}`} className="text-accent hover:underline">
                    {c.number ?? "Draft"}
                  </Link>
                </TD>
                <TD>{c.claimant.name}</TD>
                <TD>{c.title}</TD>
                <TD>
                  <StatusBadge status={CLAIM_STATUS[c.status]} />
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
          title={q || status ? "No claims match" : "No claims yet"}
          description={
            q || status
              ? "Try another search or filter."
              : "Claims appear here once staff submit them under Expenses."
          }
        />
      )}
    </>
  );
}
