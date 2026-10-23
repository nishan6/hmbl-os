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
import { BILL_SUPPLY_TYPES } from "@/lib/gst";
import { documentTotals, priceInvoiceLine } from "@/lib/invoice";
import { parseMoneyToMinor } from "@/lib/money";
import { formatBps, parsePercentToBps } from "@/lib/percent";
import { parseQuantity } from "@/lib/pricing";
import { tdsOn } from "@/lib/tds";
import type { FormState } from "@/server/http/action-result";
import type { SupplyType } from "@/generated/prisma/enums";

export type BillRow = {
  description: string;
  sacCode: string;
  quantity: string;
  unitPrice: string;
  taxRateId: string;
  itcEligible: boolean;
  accountId: string;
  projectId: string;
  budgetLineId: string;
};

type TaxRateOption = { id: string; code: string; rateBps: number; isDefault: boolean };
type AccountOption = { id: string; code: string; name: string };
type ProjectOption = {
  id: string;
  number: string;
  name: string;
  currency: string;
  budgetLines: { id: string; description: string }[];
};

/** A draft bill: the supplier's invoice, GST, TDS and lines charged to accounts and projects. */
export function BillEditor({
  action,
  defaults,
  rows: initialRows,
  taxRates,
  accounts,
  projects,
  tdsSections,
  gst,
  baseCurrency,
  cancelHref,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults: Record<string, string>;
  rows: BillRow[];
  taxRates: TaxRateOption[];
  accounts: AccountOption[];
  projects: ProjectOption[];
  tdsSections: Record<string, string>;
  /** Whether the entity is under Indian GST. */
  gst: boolean;
  baseCurrency: string;
  cancelHref: string;
}) {
  const f = useForm(action, defaults);
  const markDirty = useUnsavedChangesWarning(f.state);
  const restored = f.state.status === "error" ? f.state.values?.lines : undefined;
  const blank = (): BillRow => ({
    description: "",
    sacCode: "",
    quantity: "1",
    unitPrice: "",
    taxRateId: taxRates.find((r) => r.isDefault)?.id ?? "",
    itcEligible: true,
    accountId: "",
    projectId: "",
    budgetLineId: "",
  });
  const start = restored ? (JSON.parse(restored) as BillRow[]) : initialRows;
  const [rows, setRows] = useState(start.length ? start : [blank()]);
  const [currency, setCurrency] = useState(f.value("currency") || baseCurrency);
  const [supply, setSupply] = useState((f.value("supplyType") || "INTRA_STATE") as SupplyType);
  const [tdsRate, setTdsRate] = useState(f.value("tdsRate"));

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
  const tds = tdsOn(totals.subtotalMinor, parsePercentToBps(tdsRate || "0") ?? 0, currency);
  const money = (minor: bigint) =>
    formatMoney(minor, currency.length === 3 ? currency : baseCurrency);
  const update = (i: number, patch: Partial<BillRow>) => {
    setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    markDirty();
  };
  const change = (next: BillRow[]) => {
    setRows(next);
    markDirty();
  };

  return (
    <form
      action={f.action}
      onChange={markDirty}
      key={f.formKey}
      className="flex flex-col gap-6"
      noValidate
    >
      <FormAlert {...f} title="The bill wasn't saved" />
      <input type="hidden" name="lines" value={JSON.stringify(rows)} />
      <fieldset className="flex max-w-3xl flex-col gap-4">
        <legend className="text-md text-text mb-2 font-semibold">Supplier&apos;s invoice</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Their invoice number" required errors={f.errors("vendorInvoiceNumber")}>
            {(p) => (
              <Input
                name="vendorInvoiceNumber"
                defaultValue={f.value("vendorInvoiceNumber")}
                {...p}
              />
            )}
          </Field>
          <Field label="Invoice date" required errors={f.errors("billDate")}>
            {(p) => <Input type="date" name="billDate" defaultValue={f.value("billDate")} {...p} />}
          </Field>
          <Field label="Due date" required errors={f.errors("dueDate")}>
            {(p) => <Input type="date" name="dueDate" defaultValue={f.value("dueDate")} {...p} />}
          </Field>
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
          ) : null}
          <Field label="GST" required errors={f.errors("supplyType")}>
            {(p) => (
              <Select
                name="supplyType"
                value={supply}
                onChange={(e) => setSupply(e.target.value as SupplyType)}
                {...p}
              >
                {Object.entries(BILL_SUPPLY_TYPES)
                  .filter(([value]) => (gst ? value !== "NON_GST" : value === "NON_GST"))
                  .map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        </div>
        {gst ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="TDS section" errors={f.errors("tdsSection")}>
              {(p) => (
                <>
                  <Input
                    name="tdsSection"
                    list="bill-tds-sections"
                    defaultValue={f.value("tdsSection")}
                    {...p}
                  />
                  <datalist id="bill-tds-sections">
                    {Object.entries(tdsSections).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </datalist>
                </>
              )}
            </Field>
            <Field
              label="TDS rate (%)"
              description="On the value before GST"
              errors={f.errors("tdsRate")}
            >
              {(p) => (
                <Input
                  name="tdsRate"
                  inputMode="decimal"
                  className="tabular"
                  value={tdsRate}
                  onChange={(e) => setTdsRate(e.target.value)}
                  {...p}
                />
              )}
            </Field>
          </div>
        ) : null}
        <Field label="Notes" errors={f.errors("notes")}>
          {(p) => <Textarea name="notes" defaultValue={f.value("notes")} rows={2} {...p} />}
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-md text-text mb-2 font-semibold">Lines</legend>
        {f.errors("lines") ? (
          <p className="text-danger text-sm">{f.errors("lines")!.join(" ")}</p>
        ) : null}
        <div className="flex flex-col gap-4">
          {rows.map((row, i) => {
            const err = (field: string) => f.errors(`lines.${i}.${field}`);
            const message = (field: string) =>
              err(field) ? (
                <p className="text-danger mt-1 text-xs">{err(field)!.join(" ")}</p>
              ) : null;
            const project = projects.find((p) => p.id === row.projectId);
            return (
              <div
                key={i}
                className="border-separator grid gap-2 border-b pb-4 sm:grid-cols-[1fr_7rem_5rem_8rem_8rem_2.5rem]"
              >
                <div>
                  <Input
                    aria-label={`Line ${i + 1} description`}
                    placeholder="Description"
                    value={row.description}
                    aria-invalid={err("description") ? true : undefined}
                    onChange={(e) => update(i, { description: e.target.value })}
                  />
                  {message("description")}
                </div>
                <div>
                  <Input
                    aria-label={`Line ${i + 1} SAC or HSN code`}
                    placeholder="SAC/HSN"
                    inputMode="numeric"
                    className="tabular"
                    value={row.sacCode}
                    aria-invalid={err("sacCode") ? true : undefined}
                    onChange={(e) => update(i, { sacCode: e.target.value })}
                  />
                  {message("sacCode")}
                </div>
                <div>
                  <Input
                    aria-label={`Line ${i + 1} quantity`}
                    inputMode="decimal"
                    className="tabular text-right"
                    value={row.quantity}
                    aria-invalid={err("quantity") ? true : undefined}
                    onChange={(e) => update(i, { quantity: e.target.value })}
                  />
                  {message("quantity")}
                </div>
                <div>
                  <Input
                    aria-label={`Line ${i + 1} rate`}
                    placeholder="Rate"
                    inputMode="decimal"
                    className="tabular text-right"
                    value={row.unitPrice}
                    aria-invalid={err("unitPrice") ? true : undefined}
                    onChange={(e) => update(i, { unitPrice: e.target.value })}
                  />
                  {message("unitPrice")}
                </div>
                <p className="tabular py-2 text-right text-sm">{money(priced[i]!.amountMinor)}</p>
                <IconButton
                  label={`Remove line ${i + 1}`}
                  disabled={rows.length <= 1}
                  onClick={() => change(rows.filter((_, j) => j !== i))}
                >
                  <Trash2 aria-hidden />
                </IconButton>
                <div className="grid gap-2 sm:col-span-6 sm:grid-cols-[10rem_auto_1fr_1fr_1fr] sm:items-start">
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
                  <label className="text-text flex items-center gap-2 py-2 text-sm whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={row.itcEligible}
                      onChange={(e) => update(i, { itcEligible: e.target.checked })}
                    />
                    Claim input GST
                  </label>
                  <div>
                    <Select
                      aria-label={`Line ${i + 1} account`}
                      value={row.accountId}
                      aria-invalid={err("accountId") ? true : undefined}
                      onChange={(e) => update(i, { accountId: e.target.value })}
                    >
                      <option value="">Account…</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} · {a.name}
                        </option>
                      ))}
                    </Select>
                    {message("accountId")}
                  </div>
                  <div>
                    <Select
                      aria-label={`Line ${i + 1} project`}
                      value={row.projectId}
                      aria-invalid={err("projectId") ? true : undefined}
                      onChange={(e) => update(i, { projectId: e.target.value, budgetLineId: "" })}
                    >
                      <option value="">No project</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.number} · {p.name}
                        </option>
                      ))}
                    </Select>
                    {message("projectId")}
                  </div>
                  <div>
                    <Select
                      aria-label={`Line ${i + 1} budget line`}
                      value={row.budgetLineId}
                      disabled={!project}
                      aria-invalid={err("budgetLineId") ? true : undefined}
                      onChange={(e) => update(i, { budgetLineId: e.target.value })}
                    >
                      <option value="">{project ? "Budget line…" : "No budget line"}</option>
                      {project?.budgetLines.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.description}
                        </option>
                      ))}
                    </Select>
                    {message("budgetLineId")}
                  </div>
                </div>
              </div>
            );
          })}
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
          {totals.cgstMinor ? (
            <>
              <dt className="text-secondary">CGST</dt>
              <dd className="tabular text-right">{money(totals.cgstMinor)}</dd>
              <dt className="text-secondary">SGST</dt>
              <dd className="tabular text-right">{money(totals.sgstMinor)}</dd>
            </>
          ) : null}
          {totals.igstMinor ? (
            <>
              <dt className="text-secondary">IGST</dt>
              <dd className="tabular text-right">{money(totals.igstMinor)}</dd>
            </>
          ) : null}
          {totals.otherTaxMinor ? (
            <>
              <dt className="text-secondary">Tax</dt>
              <dd className="tabular text-right">{money(totals.otherTaxMinor)}</dd>
            </>
          ) : null}
          <dt className="border-border mt-1 border-t pt-2">Invoice total</dt>
          <dd className="border-border tabular mt-1 border-t pt-2 text-right">
            {money(totals.totalMinor)}
          </dd>
          {tds ? (
            <>
              <dt className="text-secondary">Less TDS</dt>
              <dd className="tabular text-right">−{money(tds)}</dd>
            </>
          ) : null}
          <dt className="font-semibold">To pay</dt>
          <dd className="tabular text-right font-semibold">{money(totals.totalMinor - tds)}</dd>
        </dl>
      </fieldset>

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
