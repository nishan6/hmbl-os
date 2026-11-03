import Link from "next/link";
import { HmblLockup } from "@/components/shell/brand";
import { GST_STATES, rupeesInWords, type SupplyType } from "@/lib/gst";
import {
  documentDate,
  documentDateRange,
  documentMoney,
  documentTerms,
  groupInvoiceLines,
  type LayoutItem,
  type LayoutLine,
} from "@/lib/invoice-layout";
import { formatBps } from "@/lib/percent";
import { cn } from "@/lib/cn";
import { PrintButton } from "./print-button";
import type { InvoiceKind } from "@/generated/prisma/enums";

type TaxAmounts = {
  cgstMinor: bigint;
  sgstMinor: bigint;
  igstMinor: bigint;
  otherTaxMinor: bigint;
};

export type HmblInvoiceProps = {
  /** "Tax invoice", "Pro forma invoice", "Commercial invoice". */
  title: string;
  backHref: string;
  backLabel: string;
  notice: string | null;
  number: string | null;
  invoiceDate: Date;
  dueDate: Date;
  clientPoNumber: string | null;
  client: { name: string; address: string | null; gstin: string | null };
  project: {
    name: string;
    venue: string | null;
    eventStartDate: Date | null;
    eventEndDate: Date | null;
  } | null;
  serviceName: string | null;
  placeOfSupply: { country: string; code: string | null };
  supplyType: SupplyType;
  currency: string;
  lines: (LayoutLine & { sacCode: string | null; taxRateBps: number })[];
  totals: TaxAmounts & { subtotalMinor: bigint; totalMinor: bigint };
  /** Already paid: the recorded advance, or receipts and credit notes on a tax invoice. */
  advanceMinor: bigint;
  notes: string | null;
  terms: string | null;
  supplier: { legalName: string; gstin: string | null; pan: string | null };
  bankAccounts: {
    id: string;
    accountName: string;
    bankName: string;
    accountNumber: string;
    ifsc: string | null;
    swift: string | null;
    iban: string | null;
    upiId: string | null;
  }[];
  contact: string | null;
  website: string | null;
  signatory: { name: string | null; title: string | null };
};

/**
 * An invoice in HMBL's own layout, as the client receives it: the logo and
 * title, a panel with who it's for and the project, lettered sections, the
 * total due, payment details, terms and the signatory. It still carries what
 * GST asks of a tax invoice: both GSTINs, place of supply, SAC codes, tax by
 * component and the amount in words. Always on light paper.
 */
export function HmblInvoice(d: HmblInvoiceProps) {
  const money = (minor: bigint) => documentMoney(minor, d.currency);
  const groups = groupInvoiceLines(d.lines);
  const intra = d.supplyType === "INTRA_STATE";
  const gst = d.supplyType !== "NON_GST";
  const rates = [...new Set(d.lines.map((l) => l.taxRateBps).filter((r) => r > 0))];
  const rateLabel = (bps: number) => (rates.length === 1 ? ` (${formatBps(bps)})` : "");
  const taxRows: [string, bigint][] = !gst
    ? d.totals.otherTaxMinor
      ? [["Tax", d.totals.otherTaxMinor]]
      : []
    : intra
      ? [
          [`CGST${rateLabel(rates[0]! / 2)}`, d.totals.cgstMinor],
          [`SGST${rateLabel(rates[0]! / 2)}`, d.totals.sgstMinor],
        ]
      : [[`IGST${rateLabel(rates[0] ?? 0)}`, d.totals.igstMinor]];
  const due = d.totals.totalMinor - d.advanceMinor;
  const place =
    d.placeOfSupply.country === "IN" && d.placeOfSupply.code
      ? `${GST_STATES[d.placeOfSupply.code] ?? ""} (${d.placeOfSupply.code})`
      : d.placeOfSupply.country === "IN"
        ? "India"
        : `Outside India (${d.placeOfSupply.country})`;
  const eventDates = d.project
    ? documentDateRange(d.project.eventStartDate, d.project.eventEndDate)
    : null;
  const projectLine = d.project
    ? [d.project.name, d.project.venue].filter(Boolean).join(" | ") +
      (eventDates ? ` (${eventDates})` : "")
    : null;
  const terms = documentTerms({
    terms: d.terms,
    currency: d.currency,
    subtotalMinor: d.totals.subtotalMinor,
    taxRatesBps: d.lines.map((l) => l.taxRateBps),
    sacCodes: d.lines.map((l) => l.sacCode),
  });
  const lines = (text: string | null) =>
    (text ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  const facts: [string, string][] = [
    ["Invoice#", d.number ?? "Draft"],
    ["Date", documentDate(d.invoiceDate)],
    ...(d.dueDate.getTime() !== d.invoiceDate.getTime()
      ? ([["Due", documentDate(d.dueDate)]] as [string, string][])
      : []),
    ...(d.clientPoNumber ? ([["Your PO", d.clientPoNumber]] as [string, string][]) : []),
    ...(gst ? ([["Place of supply", place]] as [string, string][]) : []),
  ];

  return (
    <div className="bg-bg flex-1 px-4 py-6 print:bg-transparent print:p-0">
      <div className="no-print mx-auto mb-4 flex max-w-[52rem] items-center justify-between gap-3">
        <Link href={d.backHref} className="text-accent text-sm hover:underline">
          {d.backLabel}
        </Link>
        <PrintButton />
      </div>
      <main
        id="main"
        className="paper bg-surface text-text border-separator mx-auto flex max-w-[52rem] flex-col gap-7 rounded-lg border px-12 py-12 text-[0.8125rem] leading-snug shadow-md print:gap-4"
      >
        {d.notice ? (
          <p
            role="status"
            className="bg-warning-soft text-warning -mt-4 rounded-md px-3 py-2 text-center text-xs font-semibold tracking-wide uppercase print:mt-0 print:py-1"
          >
            {d.notice}
          </p>
        ) : null}

        <header className="flex flex-wrap items-end justify-between gap-6">
          <HmblLockup className="h-9" title="HMBL Entertainment" />
          <h1 className="text-xl font-bold tracking-tight uppercase">{d.title}</h1>
        </header>

        <section className="bg-sunken grid gap-8 px-5 py-6 sm:grid-cols-2 print:py-4">
          <div>
            <h2 className="mb-3 text-xs font-bold tracking-wide uppercase">Invoice to</h2>
            <p className="font-semibold">{d.client.name}</p>
            {d.client.address ? (
              <p className="text-secondary mt-2 text-xs whitespace-pre-line">{d.client.address}</p>
            ) : null}
            <p className="text-secondary tabular mt-3 text-xs">
              GSTIN No.: {d.client.gstin ?? "Unregistered"}
            </p>
          </div>
          <div>
            <h2 className="mb-3 text-xs font-bold tracking-wide uppercase">Project</h2>
            {projectLine ? <p className="text-secondary text-xs">{projectLine}</p> : null}
            {d.serviceName ? <p className="text-secondary text-xs">{d.serviceName}</p> : null}
            <dl className="mt-4 grid grid-cols-[7rem_1fr] gap-y-1.5 text-xs">
              {facts.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="font-bold uppercase">{label}</dt>
                  <dd className="tabular">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <table className="border-text w-full border-collapse border text-xs">
          <thead>
            <tr className="bg-text text-surface text-left">
              <th scope="col" className="w-10 px-2 py-1.5 font-bold">
                NO.
              </th>
              <th scope="col" className="px-2 py-1.5 font-bold">
                DESCRIPTION
              </th>
              <th scope="col" className="w-24 px-2 py-1.5 text-right font-bold">
                RATE
              </th>
              <th scope="col" className="w-20 px-2 py-1.5 text-center font-bold">
                QUANTITY
              </th>
              <th scope="col" className="w-24 px-2 py-1.5 text-right font-bold">
                AMOUNT
              </th>
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.letter} className="break-inside-avoid">
              <tr className="border-text border-t">
                <td className="border-text border-r px-2 py-1">{g.letter}.</td>
                <td className="border-text border-r px-2 py-1 font-medium">{g.heading}</td>
                <Cells
                  item={g.line}
                  amountMinor={g.amountMinor}
                  money={money}
                  bold
                  showRate={!!g.line}
                />
              </tr>
              {g.line
                ? g.line.details.map((text, i) => (
                    <tr key={i} className="border-separator border-t">
                      <td className="border-text tabular border-r px-2 py-0.5 text-right">
                        {i + 1}.
                      </td>
                      <td className="border-text border-r px-2 py-0.5">{text}</td>
                      <td className="border-text border-r" />
                      <td className="border-text border-r" />
                      <td />
                    </tr>
                  ))
                : g.items.map((item) => (
                    <tr key={item.number} className="border-separator border-t align-top">
                      <td className="border-text tabular border-r px-2 py-0.5 text-right">
                        {item.number}.
                      </td>
                      <td className="border-text border-r px-2 py-0.5">
                        <p>{item.description}</p>
                        {item.details.map((text, i) => (
                          <p key={i}>{text}</p>
                        ))}
                      </td>
                      <Cells
                        item={item}
                        amountMinor={item.amountMinor}
                        money={money}
                        showRate
                        quiet={g.items.length === 1}
                      />
                    </tr>
                  ))}
            </tbody>
          ))}
        </table>

        {d.notes ? (
          <section className="border-text break-inside-avoid border text-xs">
            <h2 className="border-text border-b px-2 py-1 font-bold">Additional Notes:</h2>
            <div className="px-2 py-1 italic">
              {lines(d.notes).map((l, i) => (
                <p key={i}>{l}</p>
              ))}
            </div>
          </section>
        ) : null}

        <section className="flex break-inside-avoid flex-wrap items-start justify-between gap-6">
          <div>
            <h2 className="text-xs font-bold uppercase">Total due</h2>
            <p className="hatch tabular mt-2 px-6 py-2 text-[1.75rem] font-light tracking-wide">
              {money(due)}
            </p>
            {d.currency === "INR" ? (
              <p className="text-secondary mt-1.5 max-w-72 text-xs">{rupeesInWords(due)}</p>
            ) : null}
          </div>
          <dl className="grid grid-cols-[auto_6.5rem] gap-x-6 gap-y-1 text-xs">
            <dt className="text-right font-bold uppercase">Subtotal:</dt>
            <dd className="tabular text-right">{money(d.totals.subtotalMinor)}</dd>
            {d.advanceMinor > 0n ? (
              <>
                <dt className="text-right font-bold uppercase">(Advance):</dt>
                <dd className="tabular text-right">{money(d.advanceMinor)}</dd>
              </>
            ) : null}
            {taxRows.map(([label, amount]) => (
              <div key={label} className="contents">
                <dt className="text-right font-bold">{label}:</dt>
                <dd className="tabular text-right">{money(amount)}</dd>
              </div>
            ))}
            <dt className="text-right font-bold uppercase">Grand total:</dt>
            <dd className="tabular text-right font-bold">{money(d.totals.totalMinor)}</dd>
          </dl>
        </section>

        <section className="grid break-inside-avoid gap-8 text-xs sm:grid-cols-[2fr_3fr]">
          <div>
            <h2 className="mb-3 font-bold">Payment Info:</h2>
            {d.bankAccounts.map((b) => (
              <div key={b.id} className="mb-3">
                <p>{b.accountName}</p>
                <p className="tabular">A/C No.: {b.accountNumber}</p>
                <p className="text-secondary">{b.bankName}</p>
                {b.ifsc ? <p className="tabular">IFSC Code: {b.ifsc}</p> : null}
                {b.swift ? <p className="tabular">SWIFT: {b.swift}</p> : null}
                {b.iban ? <p className="tabular">IBAN: {b.iban}</p> : null}
                {b.upiId ? <p>UPI: {b.upiId}</p> : null}
              </div>
            ))}
            {d.supplier.gstin ? <p className="tabular">GSTIN No.: {d.supplier.gstin}</p> : null}
            {d.supplier.pan ? <p className="tabular">PAN: {d.supplier.pan}</p> : null}
          </div>
          {terms.length ? (
            <div>
              <h2 className="mb-3 font-bold">Terms &amp; Conditions:</h2>
              <ul className="flex flex-col gap-0.5">
                {terms.map((t, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span aria-hidden>•</span>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="flex break-inside-avoid flex-wrap items-end justify-between gap-8 text-xs">
          <div>
            <h2 className="font-bold">Contact</h2>
            {lines(d.contact).length ? (
              lines(d.contact).map((l, i) => <p key={i}>{l}</p>)
            ) : (
              <p>{d.supplier.legalName}</p>
            )}
          </div>
          <div className="w-52 text-center">
            <div className="border-text h-14 border-b print:h-10" aria-hidden />
            <p className="mt-1.5">{d.signatory.name ?? `For ${d.supplier.legalName}`}</p>
            <p className="text-secondary">{d.signatory.title ?? "Authorised signatory"}</p>
          </div>
        </section>

        {d.website ? <footer className="text-center text-xs font-bold">{d.website}</footer> : null}
      </main>
    </div>
  );
}

function Cells({
  item,
  amountMinor,
  money,
  bold,
  showRate,
  quiet,
}: {
  item: LayoutItem | null;
  amountMinor: bigint;
  money: (minor: bigint) => string;
  bold?: boolean;
  showRate?: boolean;
  /** A section's only line repeats the section's amount; leave it to the section row. */
  quiet?: boolean;
}) {
  return (
    <>
      <td className="border-text tabular border-r px-2 py-1 text-right">
        {showRate && item ? money(item.unitPriceMinor) : ""}
      </td>
      <td className="border-text tabular border-r px-2 py-1 text-center">
        {item ? (item.quantity ?? "") : ""}
      </td>
      <td className={cn("tabular px-2 py-1 text-right", bold && "font-bold")}>
        {quiet ? "" : money(amountMinor)}
      </td>
    </>
  );
}

/** What the document is called, as HMBL titles it: "Tax invoice" in India, "Invoice" elsewhere. */
export function documentTitle(kind: InvoiceKind, countryCode: string) {
  if (kind === "PROFORMA") return "Pro forma invoice";
  if (kind === "COMMERCIAL") return "Commercial invoice";
  return countryCode === "IN" ? "Tax invoice" : "Invoice";
}
