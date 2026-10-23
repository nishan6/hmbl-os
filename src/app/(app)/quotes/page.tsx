import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardList, Plus, Search } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { listQuotes } from "@/server/commercial/quotes";
import { getEntityContext } from "@/server/shell/entity-context";
import { formatDate, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { QUOTE_STATUS } from "./_components/status";

export const metadata = { title: "Quotes" };

export default async function QuotesPage({ searchParams }: PageProps<"/quotes">) {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "commercial.view")) notFound();
  const [params, { selectedId }] = await Promise.all([searchParams, getEntityContext(actor)]);
  const q = typeof params.q === "string" ? params.q : "";
  const quotes = await listQuotes(actor, { search: q, legalEntityId: selectedId });

  return (
    <>
      <PageHeader
        title="Quotes"
        description="Estimates and quotations, with every version kept."
        breadcrumbs={[{ label: "Commercial", href: "/quotes" }, { label: "Quotes" }]}
        actions={
          can(actor, "commercial.create") ? (
            <Button asChild variant="primary">
              <Link href="/quotes/new">
                <Plus aria-hidden />
                New quote
              </Link>
            </Button>
          ) : null
        }
      />

      <form role="search" className="mb-4 flex flex-wrap items-end gap-2" action="/quotes">
        <label className="sr-only" htmlFor="quote-search">
          Search quotes
        </label>
        <Input
          id="quote-search"
          name="q"
          defaultValue={q}
          placeholder="Number, title or client"
          className="max-w-xs"
        />
        <Button type="submit">
          <Search aria-hidden />
          Search
        </Button>
      </form>

      {quotes.length ? (
        <Table>
          <THead>
            <tr>
              <TH>Number</TH>
              <TH>Title</TH>
              <TH>Client</TH>
              <TH>Entity</TH>
              <TH>Status</TH>
              <TH align="right">Total</TH>
              <TH>Valid until</TH>
            </tr>
          </THead>
          <TBody>
            {quotes.map((quote) => (
              <TR key={quote.id}>
                <TD className="font-medium whitespace-nowrap">
                  <span className="flex items-center gap-2">
                    <Link
                      href={`/quotes/${quote.id}`}
                      className="text-accent tabular hover:underline"
                    >
                      {quote.number}
                    </Link>
                    {quote.latest.version > 1 ? (
                      <span className="text-muted text-xs">v{quote.latest.version}</span>
                    ) : null}
                    {quote.isDemo ? <Tag tone="warning">Demo</Tag> : null}
                  </span>
                </TD>
                <TD>{quote.title}</TD>
                <TD className="text-secondary">{quote.client.name}</TD>
                <TD className="text-secondary">{quote.legalEntity.code}</TD>
                <TD>
                  <StatusBadge status={QUOTE_STATUS[quote.latest.status]!} />
                </TD>
                <TD align="right">{formatMoney(quote.latest.totalMinor, quote.latest.currency)}</TD>
                <TD className="text-secondary tabular whitespace-nowrap">
                  {formatDate(quote.latest.validUntil, "UTC")}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState
          icon={ClipboardList}
          title={q ? "No quotes match" : "No quotes yet"}
          description={
            q
              ? "Try another number, title or client."
              : "Start a quote from an opportunity, or create one here."
          }
        />
      )}
    </>
  );
}
