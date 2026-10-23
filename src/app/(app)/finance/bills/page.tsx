import Link from "next/link";
import { Plus, ReceiptText, Search } from "lucide-react";
import { can } from "@/server/permissions/authorize";
import { BILL_STATUSES, listBills } from "@/server/finance/bills";
import type { BillStatus } from "@/generated/prisma/enums";
import { formatDate, formatMoney } from "@/lib/format";
import { daysOverdue } from "@/lib/invoice";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "../_components/finance-header";
import { loadFinancePage, param } from "../_components/load";
import { BILL_STATUS } from "../_components/status";

export const metadata = { title: "Bills" };

export default async function BillsPage({ searchParams }: PageProps<"/finance/bills">) {
  const { actor, params, entities, entity } = await loadFinancePage(searchParams);
  const q = param(params.q) ?? "";
  const status = param(params.status) as BillStatus | undefined;
  const bills = await listBills(actor, {
    legalEntityId: entity.id,
    search: q,
    status: status && status in BILL_STATUSES ? status : undefined,
  });
  const today = new Date();

  return (
    <>
      <FinanceHeader
        title="Bills"
        description="Suppliers' invoices: entered by Finance, approved by the project manager, then paid."
        entity={entity}
        entities={entities}
        current="/finance/bills"
        actions={
          can(actor, "finance.create", { legalEntityId: entity.id }) ? (
            <Button asChild variant="primary">
              <Link href={withEntity("/finance/bills/new", entity)}>
                <Plus aria-hidden />
                Enter a bill
              </Link>
            </Button>
          ) : null
        }
      />
      <form role="search" className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="entity" value={entity.id} />
        <label className="sr-only" htmlFor="bill-search">
          Search bills
        </label>
        <Input
          id="bill-search"
          name="q"
          defaultValue={q}
          placeholder="Number, vendor or their invoice"
          className="max-w-xs"
        />
        <label className="sr-only" htmlFor="bill-status">
          Status
        </label>
        <Select id="bill-status" name="status" defaultValue={status ?? ""} className="w-auto">
          <option value="">All</option>
          {Object.entries(BILL_STATUSES).map(([value, label]) => (
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
      {bills.length ? (
        <Table dense>
          <THead>
            <tr>
              <TH>Date</TH>
              <TH>Number</TH>
              <TH>Vendor</TH>
              <TH>Their invoice</TH>
              <TH>Due</TH>
              <TH>Status</TH>
              <TH align="right">To pay</TH>
              <TH align="right">Outstanding</TH>
            </tr>
          </THead>
          <TBody>
            {bills.map((b) => {
              const money = (minor: bigint) => formatMoney(minor, b.currency);
              const overdue = b.outstandingMinor > 0n && daysOverdue(b.dueDate, today) > 0;
              return (
                <TR key={b.id}>
                  <TD className="tabular text-secondary whitespace-nowrap">
                    {formatDate(b.billDate, "UTC")}
                  </TD>
                  <TD className="tabular whitespace-nowrap">
                    <Link href={`/finance/bills/${b.id}`} className="text-accent hover:underline">
                      {b.number ?? (b.status === "DRAFT" ? "Draft" : "To approve")}
                    </Link>
                  </TD>
                  <TD>{b.vendor.name}</TD>
                  <TD className="tabular">{b.vendorInvoiceNumber}</TD>
                  <TD className="tabular whitespace-nowrap">
                    {formatDate(b.dueDate, "UTC")}
                    {overdue ? (
                      <>
                        {" "}
                        <StatusBadge status="overdue" />
                      </>
                    ) : null}
                  </TD>
                  <TD>
                    <StatusBadge status={BILL_STATUS[b.status]} />
                  </TD>
                  <TD align="right">{money(b.payableMinor)}</TD>
                  <TD align="right">{b.outstandingMinor ? money(b.outstandingMinor) : ""}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      ) : (
        <EmptyState
          icon={ReceiptText}
          title={q || status ? "No bills match" : "No bills yet"}
          description={
            q || status
              ? "Try another search or filter."
              : "Enter suppliers' invoices as they arrive, charged to accounts and projects."
          }
        />
      )}
    </>
  );
}
