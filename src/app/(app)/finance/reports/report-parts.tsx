import Link from "next/link";
import { Download } from "lucide-react";
import { toDateOnly } from "@/lib/fiscal";
import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { TD, TR } from "@/components/ui/table";

/** A GET form choosing the report's dates, and a link to download it as CSV. */
export function ReportControls({
  entityId,
  dates,
  exportHref,
  children,
}: {
  entityId: string;
  dates: { from: Date; to: Date } | { asAt: Date };
  exportHref: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <form className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="entity" value={entityId} />
        {"asAt" in dates ? (
          <label className="text-sm font-medium">
            As at
            <Input
              type="date"
              name="asAt"
              defaultValue={toDateOnly(dates.asAt)}
              className="mt-1 w-auto"
            />
          </label>
        ) : (
          <>
            <label className="text-sm font-medium">
              From
              <Input
                type="date"
                name="from"
                defaultValue={toDateOnly(dates.from)}
                className="mt-1 w-auto"
              />
            </label>
            <label className="text-sm font-medium">
              To
              <Input
                type="date"
                name="to"
                defaultValue={toDateOnly(dates.to)}
                className="mt-1 w-auto"
              />
            </label>
          </>
        )}
        {children}
        <Button type="submit">Show</Button>
      </form>
      {exportHref ? (
        <Button asChild variant="quiet">
          <a href={exportHref} download>
            <Download className="size-4" aria-hidden />
            Download CSV
          </a>
        </Button>
      ) : null}
    </div>
  );
}

/** The query string of the export link for a report on screen. */
export function exportQuery(
  entityId: string,
  values: Record<string, string | Date | null | undefined>,
) {
  const q = new URLSearchParams({ entity: entityId });
  for (const [k, v] of Object.entries(values)) {
    if (v) q.set(k, v instanceof Date ? toDateOnly(v) : v);
  }
  return q.toString();
}

type Row = {
  account: { id: string; code: string; name: string };
  amountMinor: bigint;
  compareMinor?: bigint | null;
};

/** One titled group of account lines with its total, as table rows. */
export function GroupRows({
  label,
  rows,
  totalMinor,
  compareMinor,
  currency,
  showCompare,
  linkTo,
}: {
  label: string;
  rows: Row[];
  totalMinor: bigint;
  compareMinor?: bigint | null;
  currency: string;
  showCompare: boolean;
  /** Ledger link query, e.g. "from=…&to=…". */
  linkTo: string;
}) {
  const money = (m: bigint) => formatMoney(m, currency);
  return (
    <>
      <TR>
        <TD colSpan={showCompare ? 3 : 2} className="text-text pt-4 font-semibold">
          {label}
        </TD>
      </TR>
      {rows.map((r) => (
        <TR key={r.account.id}>
          <TD className="pl-6">
            <Link
              href={`/finance/accounts/${r.account.id}?${linkTo}`}
              className="text-accent hover:underline"
            >
              <span className="tabular text-secondary mr-2">{r.account.code}</span>
              {r.account.name}
            </Link>
          </TD>
          <TD align="right" className="tabular">
            {money(r.amountMinor)}
          </TD>
          {showCompare ? (
            <TD align="right" className="tabular text-secondary">
              {money(r.compareMinor ?? 0n)}
            </TD>
          ) : null}
        </TR>
      ))}
      <TotalRow
        label={`Total ${label.toLowerCase()}`}
        amountMinor={totalMinor}
        compareMinor={showCompare ? (compareMinor ?? 0n) : null}
        currency={currency}
      />
    </>
  );
}

export function TotalRow({
  label,
  amountMinor,
  compareMinor,
  currency,
  strong,
}: {
  label: string;
  amountMinor: bigint;
  compareMinor?: bigint | null;
  currency: string;
  strong?: boolean;
}) {
  const money = (m: bigint) => formatMoney(m, currency);
  return (
    <TR className={strong ? "font-semibold" : "font-medium"}>
      <TD>{label}</TD>
      <TD align="right" className="tabular">
        {money(amountMinor)}
      </TD>
      {compareMinor !== null && compareMinor !== undefined ? (
        <TD align="right" className="tabular text-secondary">
          {money(compareMinor)}
        </TD>
      ) : null}
    </TR>
  );
}
