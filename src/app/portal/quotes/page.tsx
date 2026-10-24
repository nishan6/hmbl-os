import Link from "next/link";
import { listSharedQuotes } from "@/server/portal/client";
import { formatDate, formatMoney } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requireClientPortal } from "../_lib/guard";
import { QuoteStatus } from "./status";

export const metadata = { title: "Quotations" };

export default async function PortalQuotesPage() {
  const actor = await requireClientPortal("quotes.respond");
  const quotes = await listSharedQuotes(actor);
  return (
    <>
      <PageHeader
        title="Quotations"
        description="Quotations HMBL has sent you. Open one to read it in full and accept or decline it."
      />
      {quotes.length ? (
        <Table>
          <THead>
            <tr>
              <TH>Quotation</TH>
              <TH>Valid until</TH>
              <TH>Status</TH>
              <TH align="right">Total</TH>
            </tr>
          </THead>
          <TBody>
            {quotes.map((q) => (
              <TR key={q.id}>
                <TD>
                  <Link href={`/portal/quotes/${q.id}`} className="text-accent hover:underline">
                    {q.title}
                  </Link>
                  <p className="text-muted text-xs">
                    {q.number} · version {q.latest.version}
                  </p>
                </TD>
                <TD className="text-secondary">{formatDate(q.latest.validUntil, "UTC")}</TD>
                <TD>
                  <QuoteStatus status={q.latest.status} />
                </TD>
                <TD align="right">{formatMoney(q.latest.totalMinor, q.latest.currency)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState title="No quotations shared with you yet" />
      )}
    </>
  );
}
