import Link from "next/link";
import { Banknote, Plus, Search } from "lucide-react";
import { can } from "@/server/permissions/authorize";
import { listPayments, PAYMENT_STATUSES } from "@/server/finance/payments";
import { PAYMENT_METHODS } from "@/server/finance/receipts";
import type { PaymentStatus } from "@/generated/prisma/enums";
import { formatDate, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "../_components/finance-header";
import { loadFinancePage, param } from "../_components/load";
import { VENDOR_PAYMENT_STATUS } from "../_components/status";

export const metadata = { title: "Payments" };

export default async function PaymentsPage({ searchParams }: PageProps<"/finance/payments">) {
  const { actor, params, entities, entity } = await loadFinancePage(searchParams);
  const q = param(params.q) ?? "";
  const status = param(params.status) as PaymentStatus | undefined;
  const payments = await listPayments(actor, {
    legalEntityId: entity.id,
    search: q,
    status: status && status in PAYMENT_STATUSES ? status : undefined,
  });

  return (
    <>
      <FinanceHeader
        title="Payments"
        description="Money paid to vendors and the bills it settles."
        entity={entity}
        entities={entities}
        current="/finance/payments"
        actions={
          can(actor, "finance.post", { legalEntityId: entity.id }) ? (
            <Button asChild variant="primary">
              <Link href={withEntity("/finance/payments/new", entity)}>
                <Plus aria-hidden />
                Record payment
              </Link>
            </Button>
          ) : null
        }
      />
      <form role="search" className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="entity" value={entity.id} />
        <label className="sr-only" htmlFor="payment-search">
          Search payments
        </label>
        <Input
          id="payment-search"
          name="q"
          defaultValue={q}
          placeholder="Number, vendor or reference"
          className="max-w-xs"
        />
        <label className="sr-only" htmlFor="payment-status">
          Status
        </label>
        <Select id="payment-status" name="status" defaultValue={status ?? ""} className="w-auto">
          <option value="">All</option>
          {Object.entries(PAYMENT_STATUSES).map(([value, label]) => (
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
      {payments.length ? (
        <Table dense>
          <THead>
            <tr>
              <TH>Date</TH>
              <TH>Number</TH>
              <TH>Vendor</TH>
              <TH>Method</TH>
              <TH>Status</TH>
              <TH align="right">Paid</TH>
              <TH align="right">Advance</TH>
            </tr>
          </THead>
          <TBody>
            {payments.map((p) => (
              <TR key={p.id}>
                <TD className="tabular text-secondary whitespace-nowrap">
                  {formatDate(p.date, "UTC")}
                </TD>
                <TD className="tabular whitespace-nowrap">
                  <Link href={`/finance/payments/${p.id}`} className="text-accent hover:underline">
                    {p.number}
                  </Link>
                </TD>
                <TD>{p.vendor.name}</TD>
                <TD className="text-secondary">
                  {PAYMENT_METHODS[p.method]}
                  {p.reference ? ` · ${p.reference}` : ""}
                </TD>
                <TD>
                  <StatusBadge status={VENDOR_PAYMENT_STATUS[p.status]} />
                </TD>
                <TD align="right">{formatMoney(p.amountMinor, p.currency)}</TD>
                <TD align="right">
                  {p.unallocatedMinor ? formatMoney(p.unallocatedMinor, p.currency) : ""}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState
          icon={Banknote}
          title={q || status ? "No payments match" : "No payments yet"}
          description={
            q || status
              ? "Try another search or filter."
              : "Record what you pay vendors, against their approved bills."
          }
        />
      )}
    </>
  );
}
