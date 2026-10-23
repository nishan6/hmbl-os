"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { formatDate, formatMoney } from "@/lib/format";
import { minorToInput, parseMoneyToMinor } from "@/lib/money";
import { allocateInOrder } from "@/lib/settlement";

export type OpenInvoice = {
  id: string;
  number: string | null;
  dueDate: Date;
  currency: string;
  outstandingMinor: bigint;
};

export const amountOf = (value: string | undefined, currency: string) =>
  value?.trim() ? (parseMoneyToMinor(value, currency) ?? 0n) : 0n;

/** Open invoices with an amount to allocate to each, and a button to fill them oldest first. */
export function AllocationTable({
  invoices,
  currency,
  amounts,
  onChange,
  available,
  errors,
}: {
  invoices: OpenInvoice[];
  currency: string;
  amounts: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  /** What there is to allocate. */
  available: bigint;
  errors: (field: string) => string[] | undefined;
}) {
  const money = (minor: bigint) => formatMoney(minor, currency);
  const allocated = invoices.reduce((s, i) => s + amountOf(amounts[i.id], currency), 0n);
  const fill = () => {
    const parts = allocateInOrder(
      available,
      invoices.map((i) => i.outstandingMinor),
    );
    onChange(
      Object.fromEntries(
        invoices.map((i, n) => [i.id, parts[n] ? minorToInput(parts[n]!, currency) : ""]),
      ),
    );
  };
  if (!invoices.length) {
    return (
      <p className="text-secondary text-sm">
        No open invoices in {currency}. The whole amount stays on account.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-sm">
          <thead>
            <tr className="text-secondary text-left text-xs">
              <th className="py-1 pr-2 font-medium">Invoice</th>
              <th className="py-1 pr-2 font-medium">Due</th>
              <th className="w-36 py-1 pr-2 text-right font-medium">Owed</th>
              <th className="w-40 py-1 pr-2 text-right font-medium">Allocate</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv, index) => {
              const err = errors(`allocations.${index}.amount`);
              return (
                <tr key={inv.id} className="align-top">
                  <td className="tabular py-2 pr-2">{inv.number}</td>
                  <td className="tabular text-secondary py-2 pr-2">
                    {formatDate(inv.dueDate, "UTC")}
                  </td>
                  <td className="tabular py-2 pr-2 text-right">{money(inv.outstandingMinor)}</td>
                  <td className="py-1 pr-2">
                    <Input
                      aria-label={`Allocate to ${inv.number}`}
                      inputMode="decimal"
                      className="tabular text-right"
                      value={amounts[inv.id] ?? ""}
                      aria-invalid={err ? true : undefined}
                      onChange={(e) => onChange({ ...amounts, [inv.id]: e.target.value })}
                    />
                    {err ? <p className="text-danger mt-1 text-xs">{err.join(" ")}</p> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button onClick={fill} disabled={available <= 0n}>
          Allocate oldest first
        </Button>
        <p className="text-sm" role="status">
          Allocated <span className="tabular">{money(allocated)}</span> · On account{" "}
          <span className={available - allocated < 0n ? "tabular text-danger" : "tabular"}>
            {money(available - allocated)}
          </span>
        </p>
      </div>
    </div>
  );
}

/** The allocations to send: every open invoice, in the order shown, so errors line up. */
export const allocationPayload = (invoices: OpenInvoice[], amounts: Record<string, string>) =>
  JSON.stringify(invoices.map((i) => ({ invoiceId: i.id, amount: amounts[i.id] ?? "" })));
