import Link from "next/link";
import { Plus } from "lucide-react";
import { can, type Actor } from "@/server/permissions/authorize";
import { listQuotes, type QuoteListOptions } from "@/server/commercial/quotes";
import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { QUOTE_STATUS } from "./status";

/** Quotes for a client or an opportunity, for their detail pages. */
export async function QuotesSection({
  actor,
  filter,
  newHref,
}: {
  actor: Actor;
  filter: QuoteListOptions;
  /** Where "New quote" goes; omitted when a quote can't be started here. */
  newHref?: string;
}) {
  if (!can(actor, "commercial.view")) return null;
  const quotes = await listQuotes(actor, filter);
  return (
    <Section
      title="Quotes"
      actions={
        newHref && can(actor, "commercial.create") ? (
          <Button asChild size="sm">
            <Link href={newHref}>
              <Plus aria-hidden />
              New quote
            </Link>
          </Button>
        ) : null
      }
    >
      {quotes.length ? (
        <Table dense>
          <THead>
            <tr>
              <TH>Quote</TH>
              <TH>Entity</TH>
              <TH>Status</TH>
              <TH align="right">Total</TH>
            </tr>
          </THead>
          <TBody>
            {quotes.map((q) => (
              <TR key={q.id}>
                <TD className="font-medium">
                  <Link href={`/quotes/${q.id}`} className="text-accent hover:underline">
                    <span className="tabular">{q.number}</span> · {q.title}
                  </Link>
                  {q.latest.version > 1 ? (
                    <span className="text-muted ml-2 text-xs">v{q.latest.version}</span>
                  ) : null}
                </TD>
                <TD className="text-secondary">{q.legalEntity.code}</TD>
                <TD>
                  <StatusBadge status={QUOTE_STATUS[q.latest.status]!} />
                </TD>
                <TD align="right">{formatMoney(q.latest.totalMinor, q.latest.currency)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <p className="text-secondary text-base">No quotes you can see.</p>
      )}
    </Section>
  );
}
