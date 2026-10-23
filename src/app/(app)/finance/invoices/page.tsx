import Link from "next/link";
import { FileText, Plus, Search } from "lucide-react";
import { can } from "@/server/permissions/authorize";
import { listInvoices } from "@/server/finance/invoices";
import type { InvoiceStatus } from "@/generated/prisma/enums";
import { formatDate, formatMoney } from "@/lib/format";
import { paymentState } from "@/lib/invoice";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "../_components/finance-header";
import { loadFinancePage, param } from "../_components/load";
import { DOCUMENT_STATUS, PAYMENT_STATUS } from "../_components/status";

export const metadata = { title: "Invoices" };

const STATUSES: Partial<Record<InvoiceStatus, string>> = {
  DRAFT: "Drafts",
  ISSUED: "Issued",
  DISCARDED: "Discarded",
};

export default async function InvoicesPage({ searchParams }: PageProps<"/finance/invoices">) {
  const { actor, params, entities, entity } = await loadFinancePage(searchParams);
  const q = param(params.q) ?? "";
  const status = param(params.status) as InvoiceStatus | undefined;
  const invoices = await listInvoices(actor, {
    legalEntityId: entity.id,
    search: q,
    status: status && status in STATUSES ? status : undefined,
  });
  const now = new Date();

  return (
    <>
      <FinanceHeader
        title="Invoices"
        description="Tax invoices to clients, and what is still owed on them."
        entity={entity}
        entities={entities}
        current="/finance/invoices"
        actions={
          can(actor, "finance.create", { legalEntityId: entity.id }) ? (
            <Button asChild variant="primary">
              <Link href={withEntity("/finance/invoices/new", entity)}>
                <Plus aria-hidden />
                New invoice
              </Link>
            </Button>
          ) : null
        }
      />
      <form role="search" className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="entity" value={entity.id} />
        <label className="sr-only" htmlFor="invoice-search">
          Search invoices
        </label>
        <Input
          id="invoice-search"
          name="q"
          defaultValue={q}
          placeholder="Number, client or PO"
          className="max-w-xs"
        />
        <label className="sr-only" htmlFor="invoice-status">
          Status
        </label>
        <Select id="invoice-status" name="status" defaultValue={status ?? ""} className="w-auto">
          <option value="">Drafts and issued</option>
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
      {invoices.length ? (
        <Table dense>
          <THead>
            <tr>
              <TH>Date</TH>
              <TH>Number</TH>
              <TH>Client</TH>
              <TH>Project</TH>
              <TH>Status</TH>
              <TH>Due</TH>
              <TH align="right">Total</TH>
              <TH align="right">Outstanding</TH>
            </tr>
          </THead>
          <TBody>
            {invoices.map((i) => {
              const money = (minor: bigint) => formatMoney(minor, i.currency);
              return (
                <TR key={i.id}>
                  <TD className="tabular text-secondary whitespace-nowrap">
                    {formatDate(i.invoiceDate, "UTC")}
                  </TD>
                  <TD className="tabular whitespace-nowrap">
                    <Link
                      href={`/finance/invoices/${i.id}`}
                      className="text-accent hover:underline"
                    >
                      {i.number ?? "Draft"}
                    </Link>
                  </TD>
                  <TD>{i.clientName}</TD>
                  <TD className="text-secondary tabular">{i.project?.number ?? ""}</TD>
                  <TD>
                    <StatusBadge
                      status={
                        i.status === "ISSUED"
                          ? PAYMENT_STATUS[paymentState(i, i, now)]
                          : DOCUMENT_STATUS[i.status]
                      }
                    />
                  </TD>
                  <TD className="tabular text-secondary whitespace-nowrap">
                    {formatDate(i.dueDate, "UTC")}
                  </TD>
                  <TD align="right">{money(i.totalMinor)}</TD>
                  <TD align="right">{i.status === "ISSUED" ? money(i.outstandingMinor) : ""}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      ) : (
        <EmptyState
          icon={FileText}
          title={q || status ? "No invoices match" : "No invoices yet"}
          description={
            q || status
              ? "Try another search or filter."
              : "Start an invoice for a client, or for a project's billing milestone."
          }
        />
      )}
    </>
  );
}
