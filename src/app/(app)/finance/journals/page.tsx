import Link from "next/link";
import { BookOpen, Plus, Search } from "lucide-react";
import { can } from "@/server/permissions/authorize";
import { JOURNAL_SOURCES, listJournals } from "@/server/finance/journals";
import type { JournalSource, JournalStatus } from "@/generated/prisma/enums";
import { formatDate, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader, withEntity } from "../_components/finance-header";
import { loadFinancePage, param } from "../_components/load";
import { JOURNAL_STATUS } from "../_components/status";

export const metadata = { title: "Journals" };

const STATUSES: Partial<Record<JournalStatus, string>> = {
  DRAFT: "Drafts",
  POSTED: "Posted",
  DISCARDED: "Discarded",
};

export default async function JournalsPage({ searchParams }: PageProps<"/finance/journals">) {
  const { actor, params, entities, entity } = await loadFinancePage(searchParams);
  const q = param(params.q) ?? "";
  const status = param(params.status) as JournalStatus | undefined;
  const source = param(params.source) as JournalSource | undefined;
  const journals = await listJournals(actor, {
    legalEntityId: entity.id,
    search: q,
    status: status && status in STATUSES ? status : undefined,
    source: source && source in JOURNAL_SOURCES ? source : undefined,
  });
  const money = (minor: bigint) => formatMoney(minor, entity.baseCurrency);

  return (
    <>
      <FinanceHeader
        title="Journals"
        description="Every posting to the ledger, from documents and by hand."
        entity={entity}
        entities={entities}
        current="/finance/journals"
        actions={
          can(actor, "finance.create", { legalEntityId: entity.id }) ? (
            <Button asChild variant="primary">
              <Link href={withEntity("/finance/journals/new", entity)}>
                <Plus aria-hidden />
                New journal
              </Link>
            </Button>
          ) : null
        }
      />
      <form role="search" className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="entity" value={entity.id} />
        <label className="sr-only" htmlFor="journal-search">
          Search journals
        </label>
        <Input
          id="journal-search"
          name="q"
          defaultValue={q}
          placeholder="Number, narration or reference"
          className="max-w-xs"
        />
        <label className="sr-only" htmlFor="journal-status">
          Status
        </label>
        <Select id="journal-status" name="status" defaultValue={status ?? ""} className="w-auto">
          <option value="">Drafts and posted</option>
          {Object.entries(STATUSES).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <label className="sr-only" htmlFor="journal-source">
          Source
        </label>
        <Select id="journal-source" name="source" defaultValue={source ?? ""} className="w-auto">
          <option value="">All sources</option>
          {Object.entries(JOURNAL_SOURCES).map(([value, label]) => (
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
      {journals.length ? (
        <Table dense>
          <THead>
            <tr>
              <TH>Date</TH>
              <TH>Number</TH>
              <TH>Narration</TH>
              <TH>Source</TH>
              <TH>Status</TH>
              <TH align="right">Amount</TH>
            </tr>
          </THead>
          <TBody>
            {journals.map((j) => (
              <TR key={j.id}>
                <TD className="tabular text-secondary whitespace-nowrap">
                  {formatDate(j.date, "UTC")}
                </TD>
                <TD className="tabular whitespace-nowrap">
                  <Link href={`/finance/journals/${j.id}`} className="text-accent hover:underline">
                    {j.number ?? "Draft"}
                  </Link>
                </TD>
                <TD>{j.narration}</TD>
                <TD className="text-secondary whitespace-nowrap">
                  {JOURNAL_SOURCES[j.source]}
                  {j.sourceRef ? ` ${j.sourceRef}` : ""}
                </TD>
                <TD>
                  <StatusBadge status={JOURNAL_STATUS[j.status]} />
                </TD>
                <TD align="right">{money(j.totalMinor)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState
          icon={BookOpen}
          title={q || status || source ? "No journals match" : "No journals yet"}
          description={
            q || status || source
              ? "Try another search or filter."
              : "Documents post their own journals. Use a manual journal for adjustments and opening balances."
          }
        />
      )}
    </>
  );
}
