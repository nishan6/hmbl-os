"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import { useUnsavedChangesWarning } from "@/components/ui/use-unsaved-changes";
import type { FormState } from "@/server/http/action-result";
import {
  AllocationTable,
  allocationPayload,
  amountOf,
  type OpenDocument,
} from "../../_components/allocation-table";

type MoneyAccount = { id: string; code: string; name: string; currency: string };

/** Money paid to a vendor, and the approved bills it settles. */
export function PaymentForm({
  action,
  vendors,
  accounts,
  bills,
  methods,
  baseCurrency,
  defaults,
  initialAllocations,
  cancelHref,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  vendors: { id: string; name: string }[];
  accounts: MoneyAccount[];
  bills: (OpenDocument & { vendorId: string })[];
  methods: Record<string, string>;
  baseCurrency: string;
  defaults: Record<string, string>;
  initialAllocations: Record<string, string>;
  cancelHref: string;
}) {
  const f = useForm(action, defaults);
  const markDirty = useUnsavedChangesWarning(f.state);
  const restored =
    f.state.status === "error" && f.state.values?.allocations
      ? Object.fromEntries(
          (JSON.parse(f.state.values.allocations) as { billId: string; amount: string }[]).map(
            (a) => [a.billId, a.amount],
          ),
        )
      : initialAllocations;
  const [vendorId, setVendorId] = useState(f.value("vendorId"));
  const [accountId, setAccountId] = useState(f.value("paidFromId") || accounts[0]?.id || "");
  const [amount, setAmount] = useState(f.value("amount"));
  const [allocations, setAllocations] = useState<Record<string, string>>(restored);
  const currency = accounts.find((a) => a.id === accountId)?.currency ?? baseCurrency;
  const open = bills.filter((b) => b.vendorId === vendorId && b.currency === currency);

  return (
    <form
      action={f.action}
      onChange={markDirty}
      key={f.formKey}
      className="flex flex-col gap-6"
      noValidate
    >
      <FormAlert {...f} title="The payment wasn't recorded" />
      <input type="hidden" name="currency" value={currency} />
      <input
        type="hidden"
        name="allocations"
        value={allocationPayload(open, allocations, "billId")}
      />
      <fieldset className="flex max-w-3xl flex-col gap-4">
        <legend className="text-md text-text mb-2 font-semibold">Payment</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Vendor" required errors={f.errors("vendorId")}>
            {(p) => (
              <Select
                name="vendorId"
                value={vendorId}
                onChange={(e) => {
                  setVendorId(e.target.value);
                  setAllocations({});
                }}
                {...p}
              >
                <option value="">Choose…</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Paid from" required errors={f.errors("paidFromId")}>
            {(p) => (
              <Select
                name="paidFromId"
                value={accountId}
                onChange={(e) => {
                  setAccountId(e.target.value);
                  setAllocations({});
                }}
                {...p}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name} ({a.currency})
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Date paid" required errors={f.errors("date")}>
            {(p) => <Input type="date" name="date" defaultValue={f.value("date")} {...p} />}
          </Field>
          <Field label="Method" required errors={f.errors("method")}>
            {(p) => (
              <Select name="method" defaultValue={f.value("method")} {...p}>
                {Object.entries(methods).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Reference"
            description="UTR, cheque or UPI number"
            errors={f.errors("reference")}
          >
            {(p) => <Input name="reference" defaultValue={f.value("reference")} {...p} />}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={`Amount paid (${currency})`} required errors={f.errors("amount")}>
            {(p) => (
              <Input
                name="amount"
                inputMode="decimal"
                className="tabular"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                {...p}
              />
            )}
          </Field>
          {currency !== baseCurrency ? (
            <Field
              label={`Rate (${baseCurrency} per 1 ${currency})`}
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
        </div>
        <Field label="Notes" errors={f.errors("notes")}>
          {(p) => <Textarea name="notes" defaultValue={f.value("notes")} rows={2} {...p} />}
        </Field>
      </fieldset>

      <fieldset className="flex max-w-3xl flex-col gap-3">
        <legend className="text-md text-text mb-2 font-semibold">Settles</legend>
        {vendorId ? (
          <AllocationTable
            invoices={open}
            currency={currency}
            amounts={allocations}
            onChange={(next) => {
              setAllocations(next);
              markDirty();
            }}
            available={amountOf(amount, currency)}
            errors={f.errors}
            noun="bill"
            remainder="Advance"
          />
        ) : (
          <p className="text-secondary text-sm">Choose the vendor to see their approved bills.</p>
        )}
      </fieldset>

      <div className="bg-surface border-separator sticky bottom-0 -mx-4 flex gap-2 border-t px-4 py-3">
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Recording…" : "Record payment"}
        </Button>
        <Button asChild variant="quiet">
          <Link href={cancelHref}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
