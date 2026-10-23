import Link from "next/link";
import { HandCoins, Plus, Search } from "lucide-react";
import { can } from "@/server/permissions/authorize";
import { listReceipts, PAYMENT_METHODS } from "@/server/finance/receipts";
import type { ReceiptStatus } from "@/generated/prisma/enums";
import { formatDate, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "../_components/finance-header";
import { loadFinancePage, param } from "../_components/load";
import { RECEIPT_STATUS } from "../_components/status";

export const metadata = { title: "Receipts" };

const STATUSES: Record<ReceiptStatus, string> = { POSTED: "Posted", VOIDED: "Voided" };

export default async function ReceiptsPage({ searchParams }: PageProps<"/finance/receipts">) {
  const { actor, params, entities, entity } = await loadFinancePage(searchParams);
  const q = param(params.q) ?? "";
  const status = param(params.status) as ReceiptStatus | undefined;
  const receipts = await listReceipts(actor, {
    legalEntityId: entity.id,
    search: q,
    status: status && status in STATUSES ? status : undefined,
  });

  return (
    <>
      <FinanceHeader
        title="Receipts"
        description="Money received from clients and the invoices it settles."
        entity={entity}
        entities={entities}
        current="/finance/receipts"
        actions={
          can(actor, "finance.post", { legalEntityId: entity.id }) ? (
            <Button asChild variant="primary">
              <Link href={withEntity("/finance/receipts/new", entity)}>
                <Plus aria-hidden />
                Record receipt
              </Link>
            </Button>
          ) : null
        }
      />
      <form role="search" className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="entity" value={entity.id} />
        <label className="sr-only" htmlFor="receipt-search">
          Search receipts
        </label>
        <Input
          id="receipt-search"
          name="q"
          defaultValue={q}
          placeholder="Number, client or reference"
          className="max-w-xs"
        />
        <label className="sr-only" htmlFor="receipt-status">
          Status
        </label>
        <Select id="receipt-status" name="status" defaultValue={status ?? ""} className="w-auto">
          <option value="">All</option>
          {Object.entries(STATUSES).map(([value, label]) => (
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
      {receipts.length ? (
        <Table dense>
          <THead>
            <tr>
              <TH>Date</TH>
              <TH>Number</TH>
              <TH>Client</TH>
              <TH>Method</TH>
              <TH>Status</TH>
              <TH align="right">Received</TH>
              <TH align="right">TDS</TH>
              <TH align="right">On account</TH>
            </tr>
          </THead>
          <TBody>
            {receipts.map((r) => {
              const money = (minor: bigint) => formatMoney(minor, r.currency);
              return (
                <TR key={r.id}>
                  <TD className="tabular text-secondary whitespace-nowrap">
                    {formatDate(r.date, "UTC")}
                  </TD>
                  <TD className="tabular whitespace-nowrap">
                    <Link
                      href={`/finance/receipts/${r.id}`}
                      className="text-accent hover:underline"
                    >
                      {r.number}
                    </Link>
                  </TD>
                  <TD>{r.client.name}</TD>
                  <TD className="text-secondary">
                    {PAYMENT_METHODS[r.method]}
                    {r.reference ? ` · ${r.reference}` : ""}
                  </TD>
                  <TD>
                    <StatusBadge status={RECEIPT_STATUS[r.status]} />
                  </TD>
                  <TD align="right">{money(r.amountMinor)}</TD>
                  <TD align="right">{r.tdsMinor ? money(r.tdsMinor) : ""}</TD>
                  <TD align="right">{r.unallocatedMinor ? money(r.unallocatedMinor) : ""}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      ) : (
        <EmptyState
          icon={HandCoins}
          title={q || status ? "No receipts match" : "No receipts yet"}
          description={
            q || status
              ? "Try another search or filter."
              : "Record money as it arrives, and allocate it to the client's invoices."
          }
        />
      )}
    </>
  );
}
