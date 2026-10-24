"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, IconButton, buttonClasses } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import { useUnsavedChangesWarning } from "@/components/ui/use-unsaved-changes";
import { formatMoney } from "@/lib/format";
import { BILL_SUPPLY_TYPES } from "@/lib/gst";
import { documentTotals, priceInvoiceLine } from "@/lib/invoice";
import { parseMoneyToMinor } from "@/lib/money";
import { formatBps } from "@/lib/percent";
import { parseQuantity } from "@/lib/pricing";
import type { FormState } from "@/server/http/action-result";
import type { SupplyType } from "@/generated/prisma/enums";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;
type Option = { id: string; label: string };

/** Starts an order: the vendor, what is bought, and the project or cost centre it is for. */
export function StartOrderForm({
  action,
  vendors,
  kinds,
  projects,
  costCentres,
  defaults,
}: {
  action: Action;
  vendors: Option[];
  kinds: Record<string, string>;
  projects: Option[];
  costCentres: Option[];
  defaults: Record<string, string>;
}) {
  const f = useForm(action, defaults);
  const [target, setTarget] = useState(f.value("costCentreId") ? "centre" : "project");
  return (
    <form action={f.action} key={f.formKey} className="flex max-w-xl flex-col gap-4" noValidate>
      <FormAlert {...f} title="The order wasn't started" />
      <Field label="Vendor" required errors={f.errors("vendorId")}>
        {(p) => (
          <Select name="vendorId" defaultValue={f.value("vendorId")} {...p}>
            <option value="">Choose…</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="What is being bought" required errors={f.errors("kind")}>
        {(p) => (
          <Select name="kind" defaultValue={f.value("kind")} {...p}>
            <option value="">Choose…</option>
            {Object.entries(kinds).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-text mb-1 text-sm font-medium">For</legend>
        <label className="text-text flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="target"
            value="project"
            checked={target === "project"}
            onChange={() => setTarget("project")}
          />
          A project
        </label>
        <label className="text-text flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="target"
            value="centre"
            checked={target === "centre"}
            onChange={() => setTarget("centre")}
          />
          A cost centre (overheads)
        </label>
      </fieldset>
      {target === "project" ? (
        <Field
          label="Project"
          required
          description="Only projects with an approved budget"
          errors={f.errors("projectId")}
        >
          {(p) => (
            <Select name="projectId" defaultValue={f.value("projectId")} {...p}>
              <option value="">Choose…</option>
              {projects.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : (
        <Field label="Cost centre" required errors={f.errors("costCentreId")}>
          {(p) => (
            <Select name="costCentreId" defaultValue={f.value("costCentreId")} {...p}>
              <option value="">Choose…</option>
              {costCentres.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Starting…" : "Start order"}
        </Button>
        <Link href="/procurement" className={buttonClasses("quiet")}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

export type OrderRow = {
  id?: string;
  description: string;
  quantity: string;
  unitPrice: string;
  taxRateId: string;
  budgetLineId: string;
  /** Received or billed so far: an amended line can't go below it, nor be removed. */
  floor?: string;
};

type TaxRateOption = { id: string; code: string; rateBps: number; isDefault: boolean };

/** An order's delivery, terms and lines, for a draft or an amendment. */
export function OrderEditor({
  action,
  defaults,
  rows: initialRows,
  taxRates,
  budgetLines,
  locations,
  currency,
  rental,
  gst,
  amending,
  cancelHref,
}: {
  action: Action;
  defaults: Record<string, string>;
  rows: OrderRow[];
  taxRates: TaxRateOption[];
  /** The project's budget lines; empty for a cost-centre order. */
  budgetLines: Option[];
  locations: Option[];
  currency: string;
  rental: boolean;
  gst: boolean;
  amending: boolean;
  cancelHref: string;
}) {
  const f = useForm(action, defaults);
  const markDirty = useUnsavedChangesWarning(f.state);
  const restored = f.state.status === "error" ? f.state.values?.lines : undefined;
  const blank = (): OrderRow => ({
    description: "",
    quantity: "1",
    unitPrice: "",
    taxRateId: taxRates.find((r) => r.isDefault)?.id ?? "",
    budgetLineId: "",
  });
  const start = restored ? (JSON.parse(restored) as OrderRow[]) : initialRows;
  const [rows, setRows] = useState(start.length ? start : [blank()]);
  const [supply, setSupply] = useState((f.value("supplyType") || "INTRA_STATE") as SupplyType);
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
  const money = (minor: bigint) => formatMoney(minor, currency);
  const update = (i: number, patch: Partial<OrderRow>) => {
    setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
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
      <FormAlert {...f} title="The order wasn't saved" />
      <input type="hidden" name="lines" value={JSON.stringify(rows)} />
      <fieldset className="flex max-w-3xl flex-col gap-4">
        <legend className="text-md text-text mb-2 font-semibold">Delivery and terms</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Needed by" errors={f.errors("requiredDate")}>
            {(p) => (
              <Input
                type="date"
                name="requiredDate"
                defaultValue={f.value("requiredDate")}
                {...p}
              />
            )}
          </Field>
          {rental ? (
            <>
              <Field label="Hire from" required errors={f.errors("hireFrom")}>
                {(p) => (
                  <Input type="date" name="hireFrom" defaultValue={f.value("hireFrom")} {...p} />
                )}
              </Field>
              <Field label="Hire to" required errors={f.errors("hireTo")}>
                {(p) => <Input type="date" name="hireTo" defaultValue={f.value("hireTo")} {...p} />}
              </Field>
            </>
          ) : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Deliver to" errors={f.errors("deliveryLocationId")}>
            {(p) => (
              <Select name="deliveryLocationId" defaultValue={f.value("deliveryLocationId")} {...p}>
                <option value="">Not set</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
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
        <Field
          label="Delivery details"
          description="Address, contact and timing"
          errors={f.errors("deliveryNotes")}
        >
          {(p) => (
            <Textarea
              name="deliveryNotes"
              defaultValue={f.value("deliveryNotes")}
              rows={2}
              {...p}
            />
          )}
        </Field>
        <Field label="Terms" errors={f.errors("terms")}>
          {(p) => <Textarea name="terms" defaultValue={f.value("terms")} rows={2} {...p} />}
        </Field>
        <Field label="Notes" errors={f.errors("notes")}>
          {(p) => <Textarea name="notes" defaultValue={f.value("notes")} rows={2} {...p} />}
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-md text-text mb-2 font-semibold">Lines ({currency})</legend>
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
            const locked = amending && !!row.id;
            const used = !!row.floor && row.floor !== "0";
            return (
              <div
                key={row.id ?? `new-${i}`}
                className="border-separator grid gap-2 border-b pb-4 sm:grid-cols-[1fr_6rem_8rem_8rem_2.5rem]"
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
                    aria-label={`Line ${i + 1} quantity`}
                    inputMode="decimal"
                    className="tabular text-right"
                    value={row.quantity}
                    aria-invalid={err("quantity") ? true : undefined}
                    onChange={(e) => update(i, { quantity: e.target.value })}
                  />
                  {used ? (
                    <p className="text-secondary tabular mt-1 text-xs">At least {row.floor}</p>
                  ) : null}
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
                  disabled={rows.length <= 1 || used}
                  onClick={() => {
                    setRows(rows.filter((_, j) => j !== i));
                    markDirty();
                  }}
                >
                  <Trash2 aria-hidden />
                </IconButton>
                <div className="grid gap-2 sm:col-span-5 sm:grid-cols-[12rem_1fr] sm:items-start">
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
                  {budgetLines.length ? (
                    <div>
                      <Select
                        aria-label={`Line ${i + 1} budget line`}
                        value={row.budgetLineId}
                        disabled={locked}
                        aria-invalid={err("budgetLineId") ? true : undefined}
                        onChange={(e) => update(i, { budgetLineId: e.target.value })}
                      >
                        <option value="">Budget line…</option>
                        {budgetLines.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.label}
                          </option>
                        ))}
                      </Select>
                      {message("budgetLineId")}
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
        <div>
          <Button
            onClick={() => {
              setRows([...rows, blank()]);
              markDirty();
            }}
          >
            <Plus aria-hidden />
            Add line
          </Button>
        </div>
        <dl className="ml-auto grid w-72 grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          <dt className="text-secondary">Before tax</dt>
          <dd className="tabular text-right">{money(totals.subtotalMinor)}</dd>
          <dt className="text-secondary">Tax</dt>
          <dd className="tabular text-right">{money(totals.taxMinor)}</dd>
          <dt className="text-text font-medium">Total</dt>
          <dd className="tabular text-text text-right font-medium">{money(totals.totalMinor)}</dd>
        </dl>
      </fieldset>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Saving…" : amending ? "Save amendment" : "Save order"}
        </Button>
        <Link href={cancelHref} className={buttonClasses("quiet")}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

/** Records what arrived (or, for rentals, what went back), line by line. */
export function ReceiptForm({
  action,
  kind,
  lines,
  locations,
  defaults,
}: {
  action: Action;
  kind: "RECEIVED" | "RETURNED";
  lines: { id: string; label: string; left: string }[];
  locations: Option[];
  defaults: Record<string, string>;
}) {
  const f = useForm(action, defaults);
  const returning = kind === "RETURNED";
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-4" noValidate>
      <FormAlert {...f} title="Nothing was recorded" />
      <input type="hidden" name="kind" value={kind} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label={returning ? "Returned on" : "Received on"}
          required
          errors={f.errors("receivedOn")}
        >
          {(p) => (
            <Input type="date" name="receivedOn" defaultValue={f.value("receivedOn")} {...p} />
          )}
        </Field>
        {returning ? null : (
          <Field label="Received at" errors={f.errors("locationId")}>
            {(p) => (
              <Select name="locationId" defaultValue={f.value("locationId")} {...p}>
                <option value="">Not recorded</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field
          label={returning ? "Return note" : "Delivery note"}
          description="Their reference, if any"
          errors={f.errors("reference")}
        >
          {(p) => <Input name="reference" defaultValue={f.value("reference")} {...p} />}
        </Field>
      </div>
      <div className="grid gap-2">
        {lines.map((l) => (
          <Field
            key={l.id}
            label={l.label}
            description={`${l.left} ${returning ? "still on hire" : "still to come"}`}
            errors={f.errors(`qty:${l.id}`)}
          >
            {(p) => (
              <Input
                name={`qty:${l.id}`}
                inputMode="decimal"
                className="tabular max-w-32"
                defaultValue={f.value(`qty:${l.id}`)}
                {...p}
              />
            )}
          </Field>
        ))}
      </div>
      <Field label="Notes" errors={f.errors("notes")}>
        {(p) => <Input name="notes" defaultValue={f.value("notes")} {...p} />}
      </Field>
      <div>
        <Button type="submit" disabled={f.pending}>
          {f.pending ? "Recording…" : returning ? "Record return" : "Record receipt"}
        </Button>
      </div>
    </form>
  );
}

/** One required reason and a button: reject, amend, cancel or close. */
export function ReasonForm({
  action,
  label,
  submitLabel,
  variant,
  confirm,
}: {
  action: Action;
  label: string;
  submitLabel: string;
  variant?: "destructive";
  confirm?: string;
}) {
  const f = useForm(action);
  return (
    <form
      action={f.action}
      key={f.formKey}
      className="flex flex-col gap-2"
      noValidate
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      <FormAlert {...f} title="Nothing was changed" />
      <Field label={label} required errors={f.errors("reason")}>
        {(p) => <Input name="reason" defaultValue={f.value("reason")} {...p} />}
      </Field>
      <div>
        <Button type="submit" size="sm" variant={variant} disabled={f.pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** The approval threshold of one entity. */
export function SettingsForm({
  action,
  defaults,
  currency,
}: {
  action: Action;
  defaults: Record<string, string>;
  currency: string;
}) {
  const f = useForm(action, defaults);
  return (
    <form action={f.action} key={f.formKey} className="flex max-w-md flex-col gap-3" noValidate>
      <FormAlert {...f} title="The setting wasn't saved" />
      <Field
        label={`Approval threshold (${currency})`}
        required
        description="Orders above this, before tax, wait for an approver. 0 means every order does. Orders in another currency always do."
        errors={f.errors("approvalThreshold")}
      >
        {(p) => (
          <Input
            name="approvalThreshold"
            inputMode="decimal"
            className="tabular"
            defaultValue={f.value("approvalThreshold")}
            {...p}
          />
        )}
      </Field>
      <div>
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
