"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import { formatMoney } from "@/lib/format";
import type { SupplyType } from "@/lib/gst";
import { documentTotals, priceCreditLine } from "@/lib/invoice";
import { minorToInput, parseMoneyToMinor } from "@/lib/money";
import type { FormState } from "@/server/http/action-result";

type CreditableLine = {
  id: string;
  description: string;
  taxRateBps: number;
  amountMinor: bigint;
  remainingMinor: bigint;
};

/** Credits part or all of an issued invoice's lines, with their GST. */
export function CreditNoteForm({
  action,
  lines,
  currency,
  supplyType,
  defaults,
  cancelHref,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  lines: CreditableLine[];
  currency: string;
  supplyType: SupplyType;
  defaults: Record<string, string>;
  cancelHref: string;
}) {
  const f = useForm(action, defaults);
  const restored = f.state.status === "error" ? f.state.values?.lines : undefined;
  const [amounts, setAmounts] = useState<string[]>(() => {
    const saved = restored ? (JSON.parse(restored) as { amount: string }[]) : null;
    return lines.map((_, i) => saved?.[i]?.amount ?? "");
  });
  const money = (minor: bigint) => formatMoney(minor, currency);
  const priced = lines.map((l, i) =>
    priceCreditLine(
      amounts[i]?.trim() ? (parseMoneyToMinor(amounts[i]!, currency) ?? 0n) : 0n,
      l.taxRateBps,
      supplyType,
    ),
  );
  const totals = documentTotals(priced);
  const payload = lines.map((l, i) => ({ invoiceLineId: l.id, amount: amounts[i] ?? "" }));
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-6" noValidate>
      <FormAlert {...f} title="The credit note wasn't saved" />
      <input type="hidden" name="lines" value={JSON.stringify(payload)} />
      <div className="max-w-form grid gap-4 sm:grid-cols-[12rem_1fr]">
        <Field label="Date" required errors={f.errors("date")}>
          {(p) => <Input type="date" name="date" defaultValue={f.value("date")} {...p} />}
        </Field>
        <Field
          label="Reason"
          required
          description="Printed on the credit note"
          errors={f.errors("reason")}
        >
          {(p) => <Input name="reason" defaultValue={f.value("reason")} {...p} />}
        </Field>
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-md text-text mb-2 font-semibold">Amounts to credit</legend>
        <p className="text-secondary -mt-2 text-sm">
          Enter the taxable value to credit on each line. GST is reversed at the line&apos;s rate.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <thead>
              <tr className="text-secondary text-left text-xs">
                <th className="py-1 pr-2 font-medium">Line</th>
                <th className="w-36 py-1 pr-2 text-right font-medium">Invoiced</th>
                <th className="w-36 py-1 pr-2 text-right font-medium">Left to credit</th>
                <th className="w-40 py-1 pr-2 text-right font-medium">Credit</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const err = f.errors(`lines.${i}.amount`);
                return (
                  <tr key={l.id} className="align-top">
                    <td className="py-2 pr-2">{l.description}</td>
                    <td className="tabular py-2 pr-2 text-right">{money(l.amountMinor)}</td>
                    <td className="tabular py-2 pr-2 text-right">{money(l.remainingMinor)}</td>
                    <td className="py-1 pr-2">
                      <div className="flex items-center gap-1">
                        <Input
                          aria-label={`Credit on ${l.description}`}
                          inputMode="decimal"
                          className="tabular text-right"
                          value={amounts[i] ?? ""}
                          disabled={l.remainingMinor <= 0n}
                          aria-invalid={err ? true : undefined}
                          onChange={(e) =>
                            setAmounts((all) => all.map((a, j) => (j === i ? e.target.value : a)))
                          }
                        />
                        <Button
                          size="sm"
                          variant="quiet"
                          disabled={l.remainingMinor <= 0n}
                          onClick={() =>
                            setAmounts((all) =>
                              all.map((a, j) =>
                                j === i ? minorToInput(l.remainingMinor, currency) : a,
                              ),
                            )
                          }
                        >
                          All
                        </Button>
                      </div>
                      {err ? <p className="text-danger mt-1 text-xs">{err.join(" ")}</p> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <dl className="ml-auto grid w-72 grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          <dt className="text-secondary">Taxable value</dt>
          <dd className="tabular text-right">{money(totals.subtotalMinor)}</dd>
          <dt className="text-secondary">Tax</dt>
          <dd className="tabular text-right">{money(totals.taxMinor)}</dd>
          <dt className="border-border mt-1 border-t pt-2 font-semibold">Credit total</dt>
          <dd className="border-border tabular mt-1 border-t pt-2 text-right font-semibold">
            {money(totals.totalMinor)}
          </dd>
        </dl>
      </fieldset>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Saving…" : "Save draft credit note"}
        </Button>
        <Button asChild variant="quiet">
          <Link href={cancelHref}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
