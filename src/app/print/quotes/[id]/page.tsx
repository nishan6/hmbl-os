import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { getQuoteDocument } from "@/server/commercial/quotes";
import { LINE_CATEGORIES } from "@/server/commercial/schemas";
import { PAYMENT_TRIGGERS } from "@/server/master-data/schemas";
import { NotFoundError } from "@/lib/errors";
import { formatDate, formatMoney } from "@/lib/format";
import { formatBps } from "@/lib/percent";
import { splitByPercent } from "@/lib/pricing";
import { PrintButton } from "./print-button";

export const metadata = { title: "Quote" };

type Schedule = {
  label: string;
  percentBps: number;
  trigger: keyof typeof PAYMENT_TRIGGERS;
  days: number;
}[];

/**
 * The quote as the client sees it: no cost, margin or internal notes. Outside
 * the app shell so it prints cleanly; the browser saves it as a PDF.
 */
export default async function QuoteDocumentPage({
  params,
  searchParams,
}: PageProps<"/print/quotes/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const actor = await requireActorOrRedirect();
  if (actor.twoFactor?.setupRequired) redirect("/");
  const versionParam = Number(query.version);
  const doc = await getQuoteDocument(actor, id, {
    version: Number.isInteger(versionParam) && versionParam > 0 ? versionParam : undefined,
  }).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const v = doc.version;
  const money = (minor: bigint) => formatMoney(minor, v.currency);
  const date = (d: Date | null) => (d ? formatDate(d, "UTC") : null);
  const schedule = v.paymentSchedule as Schedule;
  const amounts = splitByPercent(
    v.totalMinor,
    schedule.map((s) => s.percentBps),
  );
  const sent = ["ISSUED", "ACCEPTED", "DECLINED", "SUPERSEDED", "WITHDRAWN"].includes(v.status);
  const issuedOn = v.issuedAt ? formatDate(v.issuedAt, doc.entity.timezone) : null;
  const notice = !sent
    ? "Draft: not yet issued to the client"
    : v.status === "SUPERSEDED"
      ? "Superseded by a later version"
      : v.status === "WITHDRAWN"
        ? "Withdrawn"
        : null;
  const eventDates =
    v.eventStartDate && v.eventEndDate && +v.eventStartDate !== +v.eventEndDate
      ? `${date(v.eventStartDate)} – ${date(v.eventEndDate)}`
      : date(v.eventStartDate ?? v.eventEndDate);
  const texts = [
    ["Scope of work", v.scope],
    ["Deliverables", v.deliverables],
    ["Exclusions and assumptions", v.exclusions],
    ["Terms", v.terms],
  ].filter(([, text]) => text) as [string, string][];
  const sections = [...new Set(v.lines.map((l) => l.section ?? ""))];

  return (
    <div className="bg-bg flex-1 px-4 py-6 print:p-0">
      <div className="no-print mx-auto mb-4 flex max-w-[52rem] items-center justify-between gap-3">
        <Link href={`/quotes/${id}`} className="text-accent text-sm hover:underline">
          Back to the quote
        </Link>
        <PrintButton />
      </div>
      <main
        id="main"
        className="paper bg-surface text-text border-separator mx-auto flex max-w-[52rem] flex-col gap-6 rounded-lg border p-10 text-sm shadow-md"
      >
        {notice || doc.isDemo ? (
          <p
            role="status"
            className="bg-warning-soft text-warning rounded-md px-3 py-2 text-center text-xs font-semibold tracking-wide uppercase"
          >
            {[notice, doc.isDemo ? "Demo data" : null].filter(Boolean).join(" · ")}
          </p>
        ) : null}

        <header className="flex flex-wrap justify-between gap-6">
          <div>
            <p className="text-md font-semibold">
              {doc.entity.tradingName ?? doc.entity.legalName}
            </p>
            {doc.entity.tradingName ? <p>{doc.entity.legalName}</p> : null}
            {doc.entity.address ? <p className="text-secondary">{doc.entity.address}</p> : null}
            {doc.entity.taxRegistrations.map((t) => (
              <p key={t.value} className="text-secondary tabular">
                {t.type} {t.value}
              </p>
            ))}
          </div>
          <div className="text-right">
            <h1 className="text-lg font-semibold">Quotation</h1>
            <dl className="mt-1 grid grid-cols-[auto_auto] justify-end gap-x-3 gap-y-0.5">
              <dt className="text-secondary">Number</dt>
              <dd className="tabular">{doc.number}</dd>
              <dt className="text-secondary">Version</dt>
              <dd className="tabular">{v.version}</dd>
              <dt className="text-secondary">Date</dt>
              <dd className="tabular">
                {issuedOn ?? formatDate(v.updatedAt, doc.entity.timezone)}
              </dd>
              <dt className="text-secondary">Valid until</dt>
              <dd className="tabular">{date(v.validUntil)}</dd>
            </dl>
          </div>
        </header>

        <section className="grid gap-6 sm:grid-cols-2">
          <div>
            <h2 className="text-muted text-xs font-medium uppercase">Prepared for</h2>
            <p className="font-medium">{doc.client.name}</p>
            {v.contact ? <p>Attn: {v.contact.name}</p> : null}
            {doc.client.address ? <p className="text-secondary">{doc.client.address}</p> : null}
            {doc.client.taxId ? <p className="text-secondary tabular">{doc.client.taxId}</p> : null}
          </div>
          <div>
            <h2 className="text-muted text-xs font-medium uppercase">Event</h2>
            <p className="font-medium">{doc.title}</p>
            {eventDates ? <p>{eventDates}</p> : null}
            {v.venue ? <p className="text-secondary">{v.venue}</p> : null}
          </div>
        </section>

        <table className="w-full border-collapse">
          <thead>
            <tr className="border-border text-secondary border-b text-left text-xs">
              <th scope="col" className="py-2 pr-2 font-medium">
                Description
              </th>
              <th scope="col" className="tabular px-2 py-2 text-right font-medium">
                Qty
              </th>
              <th scope="col" className="tabular px-2 py-2 text-right font-medium">
                Days
              </th>
              <th scope="col" className="tabular px-2 py-2 text-right font-medium">
                Rate
              </th>
              <th scope="col" className="px-2 py-2 text-right font-medium">
                Tax
              </th>
              <th scope="col" className="tabular py-2 pl-2 text-right font-medium">
                Amount
              </th>
            </tr>
          </thead>
          {sections.map((section) => (
            <tbody key={section} className="break-inside-avoid">
              {section ? (
                <tr>
                  <th
                    scope="colgroup"
                    colSpan={6}
                    className="pt-3 pb-1 text-left text-xs font-semibold"
                  >
                    {section}
                  </th>
                </tr>
              ) : null}
              {v.lines
                .filter((l) => (l.section ?? "") === section)
                .map((l) => {
                  const fixed = l.method === "FIXED";
                  return (
                    <tr key={l.id} className="border-separator border-b align-top">
                      <td className="py-1.5 pr-2">
                        {l.description}
                        <span className="text-muted block text-xs">
                          {LINE_CATEGORIES[l.category]}
                          {l.discountBps ? ` · includes ${formatBps(l.discountBps)} discount` : ""}
                        </span>
                      </td>
                      <td className="tabular px-2 py-1.5 text-right whitespace-nowrap">
                        {fixed
                          ? "—"
                          : `${l.quantity.toString()}${l.unitCode ? ` ${l.unitCode}` : ""}`}
                      </td>
                      <td className="tabular px-2 py-1.5 text-right">
                        {fixed ? "—" : l.days.toString()}
                      </td>
                      <td className="tabular px-2 py-1.5 text-right whitespace-nowrap">
                        {fixed ? "—" : money(l.unitPriceMinor)}
                      </td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">
                        {l.taxCode ? formatBps(l.taxRateBps) : "—"}
                      </td>
                      <td className="tabular py-1.5 pl-2 text-right whitespace-nowrap">
                        {money(l.netMinor)}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          ))}
        </table>

        <dl className="ml-auto grid w-72 grid-cols-[1fr_auto] gap-x-4 gap-y-1">
          <dt className="text-secondary">Subtotal</dt>
          <dd className="tabular text-right">{money(v.subtotalMinor)}</dd>
          {v.contingencyMinor ? (
            <>
              <dt className="text-secondary">Contingency ({formatBps(v.contingencyBps)})</dt>
              <dd className="tabular text-right">{money(v.contingencyMinor)}</dd>
            </>
          ) : null}
          <dt className="text-secondary">Tax</dt>
          <dd className="tabular text-right">{money(v.taxMinor)}</dd>
          <dt className="border-border text-md mt-1 border-t pt-2 font-semibold">
            Total ({v.currency})
          </dt>
          <dd className="border-border text-md tabular mt-1 border-t pt-2 text-right font-semibold">
            {money(v.totalMinor)}
          </dd>
        </dl>

        {schedule.length ? (
          <section className="break-inside-avoid">
            <h2 className="mb-1 font-semibold">Payment schedule</h2>
            <table className="w-full">
              <tbody>
                {schedule.map((s, i) => (
                  <tr key={i} className="border-separator border-b">
                    <td className="py-1">{s.label}</td>
                    <td className="text-secondary py-1">
                      {PAYMENT_TRIGGERS[s.trigger]}
                      {s.days ? `: ${s.days} days` : ""}
                    </td>
                    <td className="tabular py-1 text-right">{formatBps(s.percentBps)}</td>
                    <td className="tabular py-1 text-right">{money(amounts[i]!)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {v.poRequired ? (
          <p className="font-medium">
            A purchase order from the client is required before work starts.
          </p>
        ) : null}

        {texts.map(([title, text]) => (
          <section key={title} className="break-inside-avoid">
            <h2 className="mb-1 font-semibold">{title}</h2>
            <p className="whitespace-pre-line">{text}</p>
          </section>
        ))}

        <footer className="border-separator text-muted mt-4 border-t pt-3 text-xs">
          {doc.entity.legalName} · {doc.number} version {v.version}
        </footer>
      </main>
    </div>
  );
}
