"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Panel } from "@/components/ui/page";
import { useForm } from "@/components/ui/use-form";
import { useUnsavedChangesWarning } from "@/components/ui/use-unsaved-changes";
import { formatMoney } from "@/lib/format";
import { parseMoneyToMinor } from "@/lib/money";
import { formatBps, parsePercentToBps } from "@/lib/percent";
import {
  MILLI,
  PRICING_METHODS,
  parseQuantity,
  priceLine,
  quoteTotals,
  validateLine,
  type LineResult,
  type PricingMethod,
} from "@/lib/pricing";
import { LINE_CATEGORIES } from "@/server/commercial/schemas";
import type { FormState } from "@/server/http/action-result";
import { Totals } from "../../_components/totals";

/** One line as the editor holds it: what the person typed. */
export type EditorRow = {
  section: string;
  category: string;
  description: string;
  method: PricingMethod;
  quantity: string;
  days: string;
  unitId: string;
  unitCost: string;
  unitPrice: string;
  markup: string;
  margin: string;
  discount: string;
  taxRateId: string;
};

type Option = { id: string; name: string };
type TaxOption = { id: string; code: string; name: string; rateBps: number };
type UnitOption = { id: string; code: string; name: string };

export type EditorOptions = {
  contacts: Option[];
  taxRates: TaxOption[];
  units: UnitOption[];
  paymentTerms: Option[];
  baseCurrency: string;
};

const blankRow = (category = "SERVICES"): EditorRow => ({
  section: "",
  category,
  description: "",
  method: "UNIT_RATE",
  quantity: "1",
  days: "1",
  unitId: "",
  unitCost: "",
  unitPrice: "",
  markup: "",
  margin: "",
  discount: "",
  taxRateId: "",
});

/** Live price of a row, or null while it can't be priced. The server recalculates on save. */
function preview(row: EditorRow, currency: string, taxBps: number): LineResult | null {
  const money = (v: string) => (v.trim() ? parseMoneyToMinor(v, currency) : 0n);
  const qty = (v: string) => (v.trim() ? parseQuantity(v) : MILLI);
  const fixed = row.method === "FIXED";
  const costPlus = row.method.startsWith("COST_PLUS");
  const quantityMilli = fixed ? MILLI : qty(row.quantity);
  const daysMilli = fixed ? MILLI : qty(row.days);
  const unitCostMinor = money(row.unitCost);
  const unitPriceMinor = costPlus ? 0n : money(row.unitPrice);
  const discountBps = row.discount.trim() ? parsePercentToBps(row.discount) : 0;
  if (
    quantityMilli === null ||
    daysMilli === null ||
    unitCostMinor === null ||
    unitPriceMinor === null ||
    discountBps === null
  ) {
    return null;
  }
  const line = {
    method: row.method,
    quantityMilli,
    daysMilli,
    unitCostMinor,
    unitPriceMinor,
    markupBps: parsePercentToBps(row.markup),
    marginBps: parsePercentToBps(row.margin),
    discountBps,
    taxRateBps: taxBps,
  };
  return validateLine(line).length ? null : priceLine(line);
}

export function QuoteEditor({
  action,
  defaults,
  rows,
  options,
  cancelHref,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults: Record<string, string>;
  rows: EditorRow[];
  options: EditorOptions;
  cancelHref: string;
}) {
  const f = useForm(action, defaults);
  const markDirty = useUnsavedChangesWarning(f.state);
  const restored = f.state.status === "error" ? f.state.values?.lines : undefined;
  const lineErrors = Object.keys(f.state.fieldErrors ?? {})
    .map((k) => /^lines\.(\d+)\./.exec(k)?.[1])
    .filter((n): n is string => n !== undefined);
  const badLines = [...new Set(lineErrors)].map((n) => Number(n) + 1);

  return (
    <form
      action={f.action}
      onChange={markDirty}
      key={f.formKey}
      className="flex flex-col gap-6"
      noValidate
    >
      <FormAlert {...f} title="The draft wasn't saved" />
      {badLines.length ? (
        <p className="text-danger text-sm" role="status">
          Check line{badLines.length > 1 ? "s" : ""} {badLines.join(", ")}.
        </p>
      ) : null}
      <EditorBody
        f={f}
        initialRows={restored ? (JSON.parse(restored) as EditorRow[]) : rows}
        options={options}
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

function EditorBody({
  f,
  initialRows,
  options,
  markDirty,
}: {
  f: ReturnType<typeof useForm>;
  initialRows: EditorRow[];
  options: EditorOptions;
  markDirty: () => void;
}) {
  const [rows, setRows] = useState(initialRows);
  const [currency, setCurrency] = useState(f.value("currency"));
  const [taxRateId, setTaxRateId] = useState(f.value("taxRateId"));
  const [contingency, setContingency] = useState(f.value("contingency"));
  const taxById = new Map(options.taxRates.map((t) => [t.id, t]));
  const headerTaxBps = taxById.get(taxRateId)?.rateBps ?? 0;
  const validCurrency = /^[A-Z]{3}$/.test(currency);
  const shownCurrency = validCurrency ? currency : options.baseCurrency;

  const priced = rows.map((row) =>
    validCurrency
      ? preview(
          row,
          currency,
          row.taxRateId ? (taxById.get(row.taxRateId)?.rateBps ?? 0) : headerTaxBps,
        )
      : null,
  );
  const contingencyBps = contingency.trim() ? (parsePercentToBps(contingency) ?? 0) : 0;
  const unpriced = priced.filter((p) => p === null).length;
  const totals = quoteTotals(
    priced.filter((p): p is LineResult => p !== null),
    {
      contingencyBps: Math.min(Math.max(contingencyBps, 0), 10000),
      contingencyTaxBps: headerTaxBps,
    },
  );

  const update = (i: number, patch: Partial<EditorRow>) =>
    setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const change = (next: EditorRow[]) => {
    setRows(next);
    markDirty();
  };
  const move = (i: number, by: number) => {
    const next = [...rows];
    [next[i], next[i + by]] = [next[i + by]!, next[i]!];
    change(next);
  };

  return (
    <>
      <input type="hidden" name="expectedUpdatedAt" value={f.value("expectedUpdatedAt")} />
      <input type="hidden" name="lines" value={JSON.stringify(rows)} />

      <fieldset className="max-w-form flex flex-col gap-4">
        <legend className="text-md text-text mb-2 font-semibold">Quote</legend>
        <Field label="Title" required errors={f.errors("title")}>
          {(p) => <Input name="title" defaultValue={f.value("title")} {...p} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contact" errors={f.errors("contactId")}>
            {(p) => (
              <Select name="contactId" defaultValue={f.value("contactId")} {...p}>
                <option value="">None</option>
                {options.contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Valid until" required errors={f.errors("validUntil")}>
            {(p) => (
              <Input type="date" name="validUntil" defaultValue={f.value("validUntil")} {...p} />
            )}
          </Field>
          <Field
            label="Currency"
            required
            description={`ISO code. ${options.baseCurrency} is this entity's own currency`}
            errors={f.errors("currency")}
          >
            {(p) => (
              <Input
                name="currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
                className="w-24"
                autoComplete="off"
                {...p}
              />
            )}
          </Field>
          {currency !== options.baseCurrency ? (
            <Field
              label={`Exchange rate to ${options.baseCurrency}`}
              description={`${options.baseCurrency} per 1 ${shownCurrency}. Needed before the quote is issued`}
              errors={f.errors("fxRate")}
            >
              {(p) => (
                <Input
                  name="fxRate"
                  inputMode="decimal"
                  defaultValue={f.value("fxRate")}
                  className="w-40"
                  {...p}
                />
              )}
            </Field>
          ) : null}
        </div>
        {currency !== options.baseCurrency ? (
          <Field
            label="Exchange rate source"
            description="Where the rate came from, and when"
            errors={f.errors("fxNote")}
          >
            {(p) => <Input name="fxNote" defaultValue={f.value("fxNote")} {...p} />}
          </Field>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Event start" errors={f.errors("eventStartDate")}>
            {(p) => (
              <Input
                type="date"
                name="eventStartDate"
                defaultValue={f.value("eventStartDate")}
                {...p}
              />
            )}
          </Field>
          <Field label="Event end" errors={f.errors("eventEndDate")}>
            {(p) => (
              <Input
                type="date"
                name="eventEndDate"
                defaultValue={f.value("eventEndDate")}
                {...p}
              />
            )}
          </Field>
        </div>
        <Field label="Venue" errors={f.errors("venue")}>
          {(p) => <Input name="venue" defaultValue={f.value("venue")} {...p} />}
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-md text-text mb-2 font-semibold">Lines</legend>
        <p className="text-secondary -mt-2 text-sm">
          Markup is profit as a share of cost; margin is profit as a share of the selling price.
          Prices are recalculated when you save.
        </p>
        <ol className="flex flex-col gap-3">
          {rows.map((row, i) => (
            <LineEditor
              key={i}
              index={i}
              count={rows.length}
              row={row}
              result={priced[i] ?? null}
              currency={shownCurrency}
              options={options}
              errors={(field) => f.errors(`lines.${i}.${field}`)}
              onChange={(patch) => update(i, patch)}
              onMove={(by) => move(i, by)}
              onDuplicate={() =>
                change([...rows.slice(0, i + 1), { ...row }, ...rows.slice(i + 1)])
              }
              onRemove={() => change(rows.filter((_, j) => j !== i))}
            />
          ))}
        </ol>
        <div>
          <Button type="button" onClick={() => change([...rows, blankRow(rows.at(-1)?.category)])}>
            <Plus aria-hidden />
            Add line
          </Button>
        </div>
      </fieldset>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <fieldset className="flex flex-col gap-4">
          <legend className="text-md text-text mb-2 font-semibold">
            Tax, contingency and payment
          </legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Default tax"
              description="For lines without their own rate, and for contingency"
              errors={f.errors("taxRateId")}
            >
              {(p) => (
                <Select
                  name="taxRateId"
                  value={taxRateId}
                  onChange={(e) => setTaxRateId(e.target.value)}
                  {...p}
                >
                  <option value="">No tax</option>
                  {options.taxRates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({formatBps(t.rateBps)})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              label="Contingency %"
              description="An allowance added to the subtotal, shown to the client"
              errors={f.errors("contingency")}
            >
              {(p) => (
                <Input
                  name="contingency"
                  inputMode="decimal"
                  value={contingency}
                  onChange={(e) => setContingency(e.target.value)}
                  className="w-28"
                  {...p}
                />
              )}
            </Field>
            <Field label="Payment terms" errors={f.errors("paymentTermId")}>
              {(p) => (
                <Select name="paymentTermId" defaultValue={f.value("paymentTermId")} {...p}>
                  <option value="">None</option>
                  {options.paymentTerms.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <label className="text-text flex items-center gap-2 self-end pb-2 text-sm">
              <input
                type="checkbox"
                name="poRequired"
                defaultChecked={f.value("poRequired") === "on"}
              />
              Client must send a purchase order
            </label>
          </div>
        </fieldset>
        <Panel aria-live="polite">
          <h3 className="text-text mb-3 text-sm font-semibold">Totals</h3>
          <Totals
            totals={totals}
            currency={shownCurrency}
            showCosts
            contingencyBps={contingencyBps}
          />
          {unpriced ? (
            <p className="text-warning mt-3 text-xs">
              {unpriced} line{unpriced > 1 ? "s" : ""} not counted until{" "}
              {unpriced > 1 ? "they're" : "it's"} complete.
            </p>
          ) : null}
        </Panel>
      </div>

      <fieldset className="max-w-form flex flex-col gap-4">
        <legend className="text-md text-text mb-2 font-semibold">Terms</legend>
        {(
          [
            ["scope", "Scope of work"],
            ["deliverables", "Deliverables"],
            ["exclusions", "Exclusions and assumptions"],
            ["terms", "Commercial terms", "Cancellation, overtime, expense recovery, rental terms"],
            ["internalNotes", "Internal notes", "Never shown to the client"],
          ] as const
        ).map(([name, label, description]) => (
          <Field key={name} label={label} description={description} errors={f.errors(name)}>
            {(p) => <Textarea name={name} rows={4} defaultValue={f.value(name)} {...p} />}
          </Field>
        ))}
      </fieldset>
    </>
  );
}

function LineEditor({
  index,
  count,
  row,
  result,
  currency,
  options,
  errors,
  onChange,
  onMove,
  onDuplicate,
  onRemove,
}: {
  index: number;
  count: number;
  row: EditorRow;
  result: LineResult | null;
  currency: string;
  options: EditorOptions;
  errors: (field: string) => string[] | undefined;
  onChange: (patch: Partial<EditorRow>) => void;
  onMove: (by: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const n = index + 1;
  const text = (
    field: keyof EditorRow,
    label: string,
    props: { className?: string; inputMode?: "decimal" } = {},
  ) => (
    <Field label={label} errors={errors(field)} className={props.className}>
      {(p) => (
        <Input
          value={row[field]}
          onChange={(e) => onChange({ [field]: e.target.value })}
          inputMode={props.inputMode}
          {...p}
        />
      )}
    </Field>
  );
  const fixed = row.method === "FIXED";
  return (
    <li>
      <Panel className="flex flex-col gap-3" aria-label={`Line ${n}`} role="group">
        <div className="flex items-start gap-3">
          <span className="text-muted tabular mt-7 w-6 shrink-0 text-right text-xs" aria-hidden>
            {n}
          </span>
          <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]">
            {text("description", "Description")}
            <Field label="Category" errors={errors("category")}>
              {(p) => (
                <Select
                  value={row.category}
                  onChange={(e) => onChange({ category: e.target.value })}
                  {...p}
                >
                  {Object.entries(LINE_CATEGORIES).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Pricing" errors={errors("method")}>
              {(p) => (
                <Select
                  value={row.method}
                  onChange={(e) => onChange({ method: e.target.value as PricingMethod })}
                  {...p}
                >
                  {Object.entries(PRICING_METHODS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {text("section", "Section")}
          </div>
          <div className="mt-6 flex shrink-0 gap-0.5">
            <IconButton
              type="button"
              size="sm"
              label={`Move line ${n} up`}
              disabled={index === 0}
              onClick={() => onMove(-1)}
            >
              <ArrowUp aria-hidden />
            </IconButton>
            <IconButton
              type="button"
              size="sm"
              label={`Move line ${n} down`}
              disabled={index === count - 1}
              onClick={() => onMove(1)}
            >
              <ArrowDown aria-hidden />
            </IconButton>
            <IconButton type="button" size="sm" label={`Duplicate line ${n}`} onClick={onDuplicate}>
              <Copy aria-hidden />
            </IconButton>
            <IconButton type="button" size="sm" label={`Remove line ${n}`} onClick={onRemove}>
              <Trash2 aria-hidden />
            </IconButton>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <span className="w-6 shrink-0" aria-hidden />
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {fixed ? null : text("quantity", "Qty", { inputMode: "decimal" })}
            {fixed ? null : text("days", "Days", { inputMode: "decimal" })}
            {fixed ? null : (
              <Field label="Unit" errors={errors("unitId")}>
                {(p) => (
                  <Select
                    value={row.unitId}
                    onChange={(e) => onChange({ unitId: e.target.value })}
                    {...p}
                  >
                    <option value="">—</option>
                    {options.units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.code}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            {text("unitCost", fixed ? "Cost" : "Unit cost", { inputMode: "decimal" })}
            {row.method === "COST_PLUS_MARKUP"
              ? text("markup", "Markup %", { inputMode: "decimal" })
              : row.method === "COST_PLUS_MARGIN"
                ? text("margin", "Margin %", { inputMode: "decimal" })
                : text("unitPrice", fixed ? "Price" : "Rate", { inputMode: "decimal" })}
            {text("discount", "Discount %", { inputMode: "decimal" })}
            <Field label="Tax" errors={errors("taxRateId")}>
              {(p) => (
                <Select
                  value={row.taxRateId}
                  onChange={(e) => onChange({ taxRateId: e.target.value })}
                  {...p}
                >
                  <option value="">Default</option>
                  {options.taxRates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.code}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="flex flex-col gap-1">
              <span className="text-text text-sm font-medium">Amount</span>
              <span className="tabular text-text flex h-8 items-center text-base">
                {result ? formatMoney(result.netMinor, currency) : "—"}
              </span>
              <span className="tabular text-muted text-xs">
                {result && result.marginBps !== null
                  ? `${formatBps(result.marginBps)} margin`
                  : " "}
              </span>
            </div>
          </div>
        </div>
      </Panel>
    </li>
  );
}
