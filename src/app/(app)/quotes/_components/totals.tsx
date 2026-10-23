import { formatMoney } from "@/lib/format";
import { formatBps } from "@/lib/percent";
import { cn } from "@/lib/cn";

export type TotalsView = {
  subtotalMinor: bigint;
  discountMinor: bigint;
  contingencyMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  costMinor: bigint;
  marginBps: number | null;
};

/** The money summary of a quote. Cost and margin only when `showCosts`. */
export function Totals({
  totals,
  currency,
  showCosts,
  contingencyBps,
  className,
}: {
  totals: TotalsView;
  currency: string;
  showCosts: boolean;
  contingencyBps: number;
  className?: string;
}) {
  const money = (minor: bigint) => formatMoney(minor, currency);
  const rows: [string, string, boolean?][] = [
    ["Subtotal", money(totals.subtotalMinor)],
    ...(totals.discountMinor
      ? [["Discounts included", `−${money(totals.discountMinor)}`] as [string, string]]
      : []),
    ...(contingencyBps
      ? [
          [`Contingency (${formatBps(contingencyBps)})`, money(totals.contingencyMinor)] as [
            string,
            string,
          ],
        ]
      : []),
    ["Tax", money(totals.taxMinor)],
    ["Total", money(totals.totalMinor), true],
  ];
  const profit = totals.subtotalMinor + totals.contingencyMinor - totals.costMinor;
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <dl className="flex flex-col gap-1 text-sm">
        {rows.map(([label, value, strong]) => (
          <div
            key={label}
            className={cn(
              "flex justify-between gap-4",
              strong && "border-separator text-md mt-1 border-t pt-2 font-semibold",
            )}
          >
            <dt className={strong ? "text-text" : "text-secondary"}>{label}</dt>
            <dd className="tabular text-text">{value}</dd>
          </div>
        ))}
      </dl>
      {showCosts ? (
        <div className="bg-sunken flex flex-col gap-1 rounded-md p-3 text-sm">
          <p className="text-muted text-xs font-medium">Internal: not shown to the client</p>
          <dl className="flex flex-col gap-1">
            <div className="flex justify-between gap-4">
              <dt className="text-secondary">Cost</dt>
              <dd className="tabular">{money(totals.costMinor)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-secondary">Gross profit</dt>
              <dd className="tabular">{money(profit)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-secondary">Gross margin</dt>
              <dd className="tabular">
                {totals.marginBps === null ? "—" : formatBps(totals.marginBps)}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  );
}
