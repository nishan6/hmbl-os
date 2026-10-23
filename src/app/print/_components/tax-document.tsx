import Link from "next/link";
import { formatMoney } from "@/lib/format";
import { GST_STATES, rupeesInWords, type SupplyType } from "@/lib/gst";
import { formatBps } from "@/lib/percent";
import { PrintButton } from "./print-button";

type Amounts = {
  cgstMinor: bigint;
  sgstMinor: bigint;
  igstMinor: bigint;
  otherTaxMinor: bigint;
  totalMinor: bigint;
};

export type TaxDocumentLine = Amounts & {
  id: string;
  description: string;
  sacCode: string | null;
  quantity?: string;
  unitPriceMinor?: bigint;
  amountMinor: bigint;
  taxRateBps: number;
};

export type TaxDocumentProps = {
  title: string;
  backHref: string;
  backLabel: string;
  /** Shown as a banner: draft, discarded or demo. */
  notice: string | null;
  facts: [string, string][];
  supplier: {
    name: string;
    legalName: string | null;
    address: string | null;
    gstin: string | null;
  };
  recipient: { name: string; address: string | null; gstin: string | null };
  placeOfSupply: { country: string; code: string | null };
  supplyType: SupplyType;
  currency: string;
  lines: TaxDocumentLine[];
  totals: Amounts & { subtotalMinor: bigint };
  notes?: string | null;
  /** Where to pay, on invoices. */
  bankAccounts?: {
    id: string;
    bankName: string;
    branch: string | null;
    accountName: string;
    accountNumber: string;
    ifsc: string | null;
    swift: string | null;
    iban: string | null;
  }[];
  footer: string;
};

/**
 * A GST tax invoice or credit note as the client receives it: supplier and
 * recipient GSTINs, place of supply, SAC codes, tax by component and the
 * amount in words. Outside the app shell so it prints cleanly.
 */
export function TaxDocument(d: TaxDocumentProps) {
  const money = (minor: bigint) => formatMoney(minor, d.currency);
  const intra = d.supplyType === "INTRA_STATE";
  const gst = d.supplyType !== "NON_GST";
  const place =
    d.placeOfSupply.country === "IN" && d.placeOfSupply.code
      ? `${GST_STATES[d.placeOfSupply.code] ?? ""} (${d.placeOfSupply.code})`
      : d.placeOfSupply.country === "IN"
        ? "India"
        : `Outside India (${d.placeOfSupply.country})`;
  const taxColumns: [string, keyof Amounts][] = !gst
    ? [["Tax", "otherTaxMinor"]]
    : intra
      ? [
          ["CGST", "cgstMinor"],
          ["SGST", "sgstMinor"],
        ]
      : [["IGST", "igstMinor"]];
  const rateOf = (l: TaxDocumentLine) => formatBps(intra ? l.taxRateBps / 2 : l.taxRateBps);

  return (
    <div className="bg-bg flex-1 px-4 py-6 print:p-0">
      <div className="no-print mx-auto mb-4 flex max-w-[56rem] items-center justify-between gap-3">
        <Link href={d.backHref} className="text-accent text-sm hover:underline">
          {d.backLabel}
        </Link>
        <PrintButton />
      </div>
      <main
        id="main"
        className="paper bg-surface text-text border-separator mx-auto flex max-w-[56rem] flex-col gap-6 rounded-lg border p-10 text-sm shadow-md"
      >
        {d.notice ? (
          <p
            role="status"
            className="bg-warning-soft text-warning rounded-md px-3 py-2 text-center text-xs font-semibold tracking-wide uppercase"
          >
            {d.notice}
          </p>
        ) : null}

        <header className="flex flex-wrap justify-between gap-6">
          <div>
            <p className="text-md font-semibold">{d.supplier.name}</p>
            {d.supplier.legalName && d.supplier.legalName !== d.supplier.name ? (
              <p>{d.supplier.legalName}</p>
            ) : null}
            {d.supplier.address ? <p className="text-secondary">{d.supplier.address}</p> : null}
            {d.supplier.gstin ? <p className="tabular">GSTIN {d.supplier.gstin}</p> : null}
          </div>
          <div className="text-right">
            <h1 className="text-lg font-semibold">{d.title}</h1>
            <dl className="mt-1 grid grid-cols-[auto_auto] justify-end gap-x-3 gap-y-0.5">
              {d.facts.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-secondary">{label}</dt>
                  <dd className="tabular">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </header>

        <section className="grid gap-6 sm:grid-cols-2">
          <div>
            <h2 className="text-muted text-xs font-medium uppercase">Billed to</h2>
            <p className="font-medium">{d.recipient.name}</p>
            {d.recipient.address ? <p className="text-secondary">{d.recipient.address}</p> : null}
            <p className="tabular">GSTIN {d.recipient.gstin ?? "Unregistered"}</p>
          </div>
          <div>
            <h2 className="text-muted text-xs font-medium uppercase">Place of supply</h2>
            <p className="font-medium">{place}</p>
          </div>
        </section>

        <table className="w-full border-collapse">
          <thead>
            <tr className="border-border text-secondary border-b text-left text-xs">
              <th scope="col" className="py-2 pr-2 font-medium">
                Description
              </th>
              <th scope="col" className="px-2 py-2 font-medium">
                SAC
              </th>
              {d.lines.some((l) => l.quantity) ? (
                <>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Qty
                  </th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">
                    Rate
                  </th>
                </>
              ) : null}
              <th scope="col" className="px-2 py-2 text-right font-medium">
                Taxable value
              </th>
              {taxColumns.map(([label]) => (
                <th key={label} scope="col" className="px-2 py-2 text-right font-medium">
                  {label}
                </th>
              ))}
              <th scope="col" className="py-2 pl-2 text-right font-medium">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.id} className="border-separator border-b align-top">
                <td className="py-1.5 pr-2">{l.description}</td>
                <td className="tabular px-2 py-1.5">{l.sacCode ?? ""}</td>
                {d.lines.some((x) => x.quantity) ? (
                  <>
                    <td className="tabular px-2 py-1.5 text-right">{l.quantity}</td>
                    <td className="tabular px-2 py-1.5 text-right whitespace-nowrap">
                      {l.unitPriceMinor !== undefined ? money(l.unitPriceMinor) : ""}
                    </td>
                  </>
                ) : null}
                <td className="tabular px-2 py-1.5 text-right whitespace-nowrap">
                  {money(l.amountMinor)}
                </td>
                {taxColumns.map(([label, key]) => (
                  <td key={label} className="tabular px-2 py-1.5 text-right whitespace-nowrap">
                    {money(l[key])}
                    <span className="text-muted block text-xs">{rateOf(l)}</span>
                  </td>
                ))}
                <td className="tabular py-1.5 pl-2 text-right whitespace-nowrap">
                  {money(l.totalMinor)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="ml-auto grid w-80 grid-cols-[1fr_auto] gap-x-4 gap-y-1">
          <dt className="text-secondary">Taxable value</dt>
          <dd className="tabular text-right">{money(d.totals.subtotalMinor)}</dd>
          {taxColumns.map(([label, key]) => (
            <div key={label} className="contents">
              <dt className="text-secondary">{label}</dt>
              <dd className="tabular text-right">{money(d.totals[key])}</dd>
            </div>
          ))}
          <dt className="border-border text-md mt-1 border-t pt-2 font-semibold">
            Total ({d.currency})
          </dt>
          <dd className="border-border text-md tabular mt-1 border-t pt-2 text-right font-semibold">
            {money(d.totals.totalMinor)}
          </dd>
        </dl>
        {d.currency === "INR" ? (
          <p>
            <span className="text-secondary">Amount in words: </span>
            {rupeesInWords(d.totals.totalMinor)}
          </p>
        ) : null}
        {d.supplyType === "EXPORT" ? (
          <p className="text-secondary">Supply meant for export.</p>
        ) : null}

        {d.bankAccounts?.length ? (
          <section className="break-inside-avoid">
            <h2 className="mb-1 font-semibold">Payment details</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {d.bankAccounts.map((b) => (
                <dl key={b.id} className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                  <dt className="text-secondary">Account name</dt>
                  <dd>{b.accountName}</dd>
                  <dt className="text-secondary">Bank</dt>
                  <dd>
                    {b.bankName}
                    {b.branch ? `, ${b.branch}` : ""}
                  </dd>
                  <dt className="text-secondary">Account number</dt>
                  <dd className="tabular">{b.accountNumber}</dd>
                  {b.ifsc ? (
                    <>
                      <dt className="text-secondary">IFSC</dt>
                      <dd className="tabular">{b.ifsc}</dd>
                    </>
                  ) : null}
                  {b.swift ? (
                    <>
                      <dt className="text-secondary">SWIFT</dt>
                      <dd className="tabular">{b.swift}</dd>
                    </>
                  ) : null}
                  {b.iban ? (
                    <>
                      <dt className="text-secondary">IBAN</dt>
                      <dd className="tabular">{b.iban}</dd>
                    </>
                  ) : null}
                </dl>
              ))}
            </div>
          </section>
        ) : null}

        {d.notes ? (
          <section className="break-inside-avoid">
            <h2 className="mb-1 font-semibold">Notes</h2>
            <p className="whitespace-pre-line">{d.notes}</p>
          </section>
        ) : null}

        <section className="mt-6 flex break-inside-avoid justify-end">
          <div className="text-right">
            <p>For {d.supplier.legalName ?? d.supplier.name}</p>
            <p className="text-secondary mt-10">Authorised signatory</p>
          </div>
        </section>

        <footer className="border-separator text-muted mt-4 border-t pt-3 text-xs">
          {d.footer}
        </footer>
      </main>
    </div>
  );
}

export function addressOf(e: {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
}) {
  return (
    [e.addressLine1, e.addressLine2, [e.city, e.region, e.postalCode].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", ") || null
  );
}
