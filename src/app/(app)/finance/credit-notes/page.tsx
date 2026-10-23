import Link from "next/link";
import { ReceiptText, Search } from "lucide-react";
import { listCreditNotes } from "@/server/finance/credit-notes";
import type { InvoiceStatus } from "@/generated/prisma/enums";
import { formatDate, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader } from "../_components/finance-header";
import { loadFinancePage, param } from "../_components/load";
import { DOCUMENT_STATUS } from "../_components/status";

export const metadata = { title: "Credit notes" };

const STATUSES: Partial<Record<InvoiceStatus, string>> = {
  DRAFT: "Drafts",
  ISSUED: "Issued",
  DISCARDED: "Discarded",
};

export default async function CreditNotesPage({
  searchParams,
}: PageProps<"/finance/credit-notes">) {
  const { actor, params, entities, entity } = await loadFinancePage(searchParams);
  const q = param(params.q) ?? "";
  const status = param(params.status) as InvoiceStatus | undefined;
  const notes = await listCreditNotes(actor, {
    legalEntityId: entity.id,
    search: q,
    status: status && status in STATUSES ? status : undefined,
  });

  return (
    <>
      <FinanceHeader
        title="Credit notes"
        description="Reductions to issued invoices. Start one from the invoice."
        entity={entity}
        entities={entities}
        current="/finance/credit-notes"
      />
      <form role="search" className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="entity" value={entity.id} />
        <label className="sr-only" htmlFor="credit-search">
          Search credit notes
        </label>
        <Input
          id="credit-search"
          name="q"
          defaultValue={q}
          placeholder="Number, invoice, client or reason"
          className="max-w-xs"
        />
        <label className="sr-only" htmlFor="credit-status">
          Status
        </label>
        <Select id="credit-status" name="status" defaultValue={status ?? ""} className="w-auto">
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
      {notes.length ? (
        <Table dense>
          <THead>
            <tr>
              <TH>Date</TH>
              <TH>Number</TH>
              <TH>Invoice</TH>
              <TH>Client</TH>
              <TH>Reason</TH>
              <TH>Status</TH>
              <TH align="right">Total</TH>
            </tr>
          </THead>
          <TBody>
            {notes.map((c) => (
              <TR key={c.id}>
                <TD className="tabular text-secondary whitespace-nowrap">
                  {formatDate(c.date, "UTC")}
                </TD>
                <TD className="tabular whitespace-nowrap">
                  <Link
                    href={`/finance/credit-notes/${c.id}`}
                    className="text-accent hover:underline"
                  >
                    {c.number ?? "Draft"}
                  </Link>
                </TD>
                <TD className="tabular whitespace-nowrap">
                  <Link
                    href={`/finance/invoices/${c.invoice.id}`}
                    className="text-accent hover:underline"
                  >
                    {c.invoice.number}
                  </Link>
                </TD>
                <TD>{c.invoice.clientName}</TD>
                <TD className="text-secondary">{c.reason}</TD>
                <TD>
                  <StatusBadge status={DOCUMENT_STATUS[c.status]} />
                </TD>
                <TD align="right">{formatMoney(c.totalMinor, c.invoice.currency)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState
          icon={ReceiptText}
          title={q || status ? "No credit notes match" : "No credit notes yet"}
          description={
            q || status
              ? "Try another search or filter."
              : "To correct an issued invoice, open it and choose Credit note."
          }
        />
      )}
    </>
  );
}
