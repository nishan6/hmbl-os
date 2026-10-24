"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import { useUnsavedChangesWarning } from "@/components/ui/use-unsaved-changes";
import { formatMoney } from "@/lib/format";
import { GST_STATES, SUPPLY_TYPES, supplyTypeFor } from "@/lib/gst";
import { documentTotals, priceInvoiceLine } from "@/lib/invoice";
import { parseMoneyToMinor } from "@/lib/money";
import { formatBps } from "@/lib/percent";
import { parseQuantity } from "@/lib/pricing";
import type { FormState } from "@/server/http/action-result";

export type InvoiceRow = {
  description: string;
  sacCode: string;
  quantity: string;
  unitPrice: string;
  taxRateId: string;
  revenueAccountId: string;
};

type TaxRateOption = {
  id: string;
  code: string;
  name: string;
  rateBps: number;
  isDefault: boolean;
};
type AccountOption = { id: string; code: string; name: string; systemKey: string | null };

const STATES = Object.entries(GST_STATES).sort(([, a], [, b]) => a.localeCompare(b));

/** A draft invoice: dates, currency, place of supply and priced lines with GST. */
export function InvoiceEditor({
  action,
  defaults,
  rows: initialRows,
  taxRates,
  accounts,
  tax,
  services,
  baseCurrency,
  cancelHref,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults: Record<string, string>;
  rows: InvoiceRow[];
  taxRates: TaxRateOption[];
  accounts: AccountOption[];
  tax: { countryCode: string; stateCode: string | null };
  /** The entity's invoice services ({SERVICE} in the number). */
  services: { code: string; name: string }[];
  baseCurrency: string;
  cancelHref: string;
}) {
  const f = useForm(action, defaults);
  const markDirty = useUnsavedChangesWarning(f.state);
  const restored = f.state.status === "error" ? f.state.values?.lines : undefined;
  return (
    <form
      action={f.action}
      onChange={markDirty}
      key={f.formKey}
      className="flex flex-col gap-6"
      noValidate
    >
      <FormAlert {...f} title="The invoice wasn't saved" />
      <Body
        f={f}
        initialRows={restored ? (JSON.parse(restored) as InvoiceRow[]) : initialRows}
        taxRates={taxRates}
        accounts={accounts}
        tax={tax}
        services={services}
        baseCurrency={baseCurrency}
        markDirty={markDirty}
      />
      <div className="bg-surface border-separator sticky bottom-0 -mx-4 flex gap-2 border-t px-4 py-3">
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Saving…" : "Save draft"}
        </Button>
        <Button asChild variant="quiet">
          <Link href={cancelHref}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}

function Body({
  f,
  initialRows,
  taxRates,
  accounts,
  tax,
  services,
  baseCurrency,
  markDirty,
}: {
  f: ReturnType<typeof useForm>;
  initialRows: InvoiceRow[];
  taxRates: TaxRateOption[];
  accounts: AccountOption[];
  tax: { countryCode: string; stateCode: string | null };
  services: { code: string; name: string }[];
  baseCurrency: string;
  markDirty: () => void;
}) {
  const blank = (): InvoiceRow => ({
    description: "",
    sacCode: "998596",
    quantity: "1",
    unitPrice: "",
    taxRateId: taxRates.find((r) => r.isDefault)?.id ?? "",
    revenueAccountId: accounts.find((a) => a.systemKey === "REVENUE")?.id ?? "",
  });
  const [rows, setRows] = useState(initialRows.length ? initialRows : [blank()]);
  const [currency, setCurrency] = useState(f.value("currency") || baseCurrency);
  const [country, setCountry] = useState(f.value("placeOfSupplyCountry") || tax.countryCode);
  const [stateCode, setStateCode] = useState(f.value("placeOfSupplyCode"));
  const [serviceCode, setServiceCode] = useState(f.value("serviceCode"));
  const gst = tax.countryCode === "IN";
  const supply = supplyTypeFor(tax, {
    countryCode: country.toUpperCase(),
    stateCode: country.toUpperCase() === "IN" ? stateCode || null : null,
  });
  const priced = rows.map((r) =>
    priceInvoiceLine(
      {
        quantityMilli: parseQuantity(r.quantity) ?? 0n,
        unitPriceMinor: r.unitPrice.trim() ? (parseMoneyToMinor(r.unitPrice, currency) ?? 0n) : 0n,
        taxRateBps: taxRates.find((t) => t.id === r.taxRateId)?.rateBps ?? 0,
      },
      supply,
    ),
  );
  const totals = documentTotals(priced);
  const money = (minor: bigint) =>
    formatMoney(minor, currency.length === 3 ? currency : baseCurrency);
  const update = (i: number, patch: Partial<InvoiceRow>) =>
    setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const change = (next: InvoiceRow[]) => {
    setRows(next);
    markDirty();
  };

  return (
    <>
      <input type="hidden" name="lines" value={JSON.stringify(rows)} />
      <fieldset className="flex max-w-3xl flex-col gap-4">
        <legend className="text-md text-text mb-2 font-semibold">Invoice</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Invoice date" required errors={f.errors("invoiceDate")}>
            {(p) => (
              <Input type="date" name="invoiceDate" defaultValue={f.value("invoiceDate")} {...p} />
            )}
          </Field>
          <Field label="Due date" required errors={f.errors("dueDate")}>
            {(p) => <Input type="date" name="dueDate" defaultValue={f.value("dueDate")} {...p} />}
          </Field>
          <Field label="Client PO number" errors={f.errors("clientPoNumber")}>
            {(p) => <Input name="clientPoNumber" defaultValue={f.value("clientPoNumber")} {...p} />}
          </Field>
          {services.length ? (
            <Field
              label="Service"
              description="Part of the invoice number"
              errors={f.errors("serviceCode")}
            >
              {(p) => (
                <Select
                  name="serviceCode"
                  value={serviceCode}
                  onChange={(e) => setServiceCode(e.target.value)}
                  {...p}
                >
                  <option value="">Choose…</option>
                  {services.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.code} · {s.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Currency" required errors={f.errors("currency")}>
            {(p) => (
              <Input
                name="currency"
                value={currency}
                maxLength={3}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                {...p}
              />
            )}
          </Field>
          {currency !== baseCurrency ? (
            <>
              <Field
                label={`Rate (${baseCurrency} per 1 ${currency || "unit"})`}
                required
                errors={f.errors("fxRate")}
              >
                {(p) => (
                  <Input
                    name="fxRate"
                    inputMode="decimal"
                    className="tabular"
                    defaultValue={f.value("fxRate")}
                    {...p}
                  />
                )}
              </Field>
              <Field
                label="Rate source"
                description="Bank or reference rate used"
                errors={f.errors("fxNote")}
              >
                {(p) => <Input name="fxNote" defaultValue={f.value("fxNote")} {...p} />}
              </Field>
            </>
          ) : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Place of supply: country"
            required
            description="Two-letter code, such as IN"
            errors={f.errors("placeOfSupplyCountry")}
          >
            {(p) => (
              <Input
                name="placeOfSupplyCountry"
                value={country}
                maxLength={2}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
                {...p}
              />
            )}
          </Field>
          {gst && country === "IN" ? (
            <Field label="Place of supply: state" required errors={f.errors("placeOfSupplyCode")}>
              {(p) => (
                <Select
                  name="placeOfSupplyCode"
                  value={stateCode}
                  onChange={(e) => setStateCode(e.target.value)}
                  {...p}
                >
                  <option value="">Choose…</option>
                  {STATES.map(([code, name]) => (
                    <option key={code} value={code}>
                      {name} ({code})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          <div className="flex flex-col gap-1">
            <span className="text-text text-sm font-medium">Tax</span>
            <p className="text-secondary text-sm" role="status">
              {SUPPLY_TYPES[supply]}
            </p>
          </div>
        </div>
        <Field label="Notes on the invoice" errors={f.errors("notes")}>
          {(p) => <Textarea name="notes" defaultValue={f.value("notes")} rows={2} {...p} />}
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-md text-text mb-2 font-semibold">Lines</legend>
        {f.errors("lines") ? (
          <p className="text-danger text-sm">{f.errors("lines")!.join(" ")}</p>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[60rem] border-collapse text-sm">
            <thead>
              <tr className="text-secondary text-left text-xs">
                <th className="py-1 pr-2 font-medium">Description</th>
                <th className="w-28 py-1 pr-2 font-medium">SAC</th>
                <th className="w-20 py-1 pr-2 text-right font-medium">Qty</th>
                <th className="w-32 py-1 pr-2 text-right font-medium">Rate</th>
                <th className="w-32 py-1 pr-2 font-medium">GST</th>
                <th className="w-48 py-1 pr-2 font-medium">Income account</th>
                <th className="w-32 py-1 pr-2 text-right font-medium">Amount</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const err = (field: string) => f.errors(`lines.${i}.${field}`);
                const message = (field: string) =>
                  err(field) ? (
                    <p className="text-danger mt-1 text-xs">{err(field)!.join(" ")}</p>
                  ) : null;
                return (
                  <tr key={i} className="align-top">
                    <td className="py-1 pr-2">
                      <Input
                        aria-label={`Line ${i + 1} description`}
                        value={row.description}
                        aria-invalid={err("description") ? true : undefined}
                        onChange={(e) => update(i, { description: e.target.value })}
                      />
                      {message("description")}
                    </td>
                    <td className="py-1 pr-2">
                      <Input
                        aria-label={`Line ${i + 1} SAC code`}
                        inputMode="numeric"
                        className="tabular"
                        value={row.sacCode}
                        aria-invalid={err("sacCode") ? true : undefined}
                        onChange={(e) => update(i, { sacCode: e.target.value })}
                      />
                      {message("sacCode")}
                    </td>
                    <td className="py-1 pr-2">
                      <Input
                        aria-label={`Line ${i + 1} quantity`}
                        inputMode="decimal"
                        className="tabular text-right"
                        value={row.quantity}
                        aria-invalid={err("quantity") ? true : undefined}
                        onChange={(e) => update(i, { quantity: e.target.value })}
                      />
                      {message("quantity")}
                    </td>
                    <td className="py-1 pr-2">
                      <Input
                        aria-label={`Line ${i + 1} rate`}
                        inputMode="decimal"
                        className="tabular text-right"
                        value={row.unitPrice}
                        aria-invalid={err("unitPrice") ? true : undefined}
                        onChange={(e) => update(i, { unitPrice: e.target.value })}
                      />
                      {message("unitPrice")}
                    </td>
                    <td className="py-1 pr-2">
                      <Select
                        aria-label={`Line ${i + 1} GST rate`}
                        value={row.taxRateId}
                        onChange={(e) => update(i, { taxRateId: e.target.value })}
                      >
                        <option value="">No tax</option>
                        {taxRates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.code} · {formatBps(t.rateBps)}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-1 pr-2">
                      <Select
                        aria-label={`Line ${i + 1} income account`}
                        value={row.revenueAccountId}
                        aria-invalid={err("revenueAccountId") ? true : undefined}
                        onChange={(e) => update(i, { revenueAccountId: e.target.value })}
                      >
                        <option value="">Choose…</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} · {a.name}
                          </option>
                        ))}
                      </Select>
                      {message("revenueAccountId")}
                    </td>
                    <td className="tabular py-2 pr-2 text-right">
                      {money(priced[i]!.amountMinor)}
                    </td>
                    <td className="py-1">
                      <IconButton
                        label={`Remove line ${i + 1}`}
                        disabled={rows.length <= 1}
                        onClick={() => change(rows.filter((_, j) => j !== i))}
                      >
                        <Trash2 aria-hidden />
                      </IconButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div>
          <Button onClick={() => change([...rows, blank()])}>
            <Plus aria-hidden />
            Add line
          </Button>
        </div>
        <dl className="ml-auto grid w-72 grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          <dt className="text-secondary">Taxable value</dt>
          <dd className="tabular text-right">{money(totals.subtotalMinor)}</dd>
          {totals.cgstMinor || supply === "INTRA_STATE" ? (
            <>
              <dt className="text-secondary">CGST</dt>
              <dd className="tabular text-right">{money(totals.cgstMinor)}</dd>
              <dt className="text-secondary">SGST</dt>
              <dd className="tabular text-right">{money(totals.sgstMinor)}</dd>
            </>
          ) : null}
          {totals.igstMinor || supply === "INTER_STATE" || supply === "EXPORT" ? (
            <>
              <dt className="text-secondary">IGST</dt>
              <dd className="tabular text-right">{money(totals.igstMinor)}</dd>
            </>
          ) : null}
          {totals.otherTaxMinor || supply === "NON_GST" ? (
            <>
              <dt className="text-secondary">Tax</dt>
              <dd className="tabular text-right">{money(totals.otherTaxMinor)}</dd>
            </>
          ) : null}
          <dt className="border-border mt-1 border-t pt-2 font-semibold">Total</dt>
          <dd className="border-border tabular mt-1 border-t pt-2 text-right font-semibold">
            {money(totals.totalMinor)}
          </dd>
        </dl>
      </fieldset>
    </>
  );
}
