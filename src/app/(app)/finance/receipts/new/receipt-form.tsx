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

/** Money received from a client, with TDS, and how it settles their invoices. */
export function ReceiptForm({
  action,
  clients,
  accounts,
  invoices,
  methods,
  tdsSections,
  baseCurrency,
  defaults,
  initialAllocations,
  cancelHref,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  clients: { id: string; name: string }[];
  accounts: MoneyAccount[];
  invoices: (OpenDocument & { clientId: string })[];
  methods: Record<string, string>;
  tdsSections: Record<string, string>;
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
          (JSON.parse(f.state.values.allocations) as { invoiceId: string; amount: string }[]).map(
            (a) => [a.invoiceId, a.amount],
          ),
        )
      : initialAllocations;
  const [clientId, setClientId] = useState(f.value("clientId"));
  const [accountId, setAccountId] = useState(f.value("depositAccountId") || accounts[0]?.id || "");
  const [amount, setAmount] = useState(f.value("amount"));
  const [tds, setTds] = useState(f.value("tds"));
  const [allocations, setAllocations] = useState<Record<string, string>>(restored);
  const currency = accounts.find((a) => a.id === accountId)?.currency ?? baseCurrency;
  const open = invoices.filter((i) => i.clientId === clientId && i.currency === currency);
  const available = amountOf(amount, currency) + amountOf(tds, currency);
  const foreign = currency !== baseCurrency;

  return (
    <form
      action={f.action}
      onChange={markDirty}
      key={f.formKey}
      className="flex flex-col gap-6"
      noValidate
    >
      <FormAlert {...f} title="The receipt wasn't recorded" />
      <input type="hidden" name="currency" value={currency} />
      <input type="hidden" name="allocations" value={allocationPayload(open, allocations)} />
      <fieldset className="flex max-w-3xl flex-col gap-4">
        <legend className="text-md text-text mb-2 font-semibold">Receipt</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Client" required errors={f.errors("clientId")}>
            {(p) => (
              <Select
                name="clientId"
                value={clientId}
                onChange={(e) => {
                  setClientId(e.target.value);
                  setAllocations({});
                }}
                {...p}
              >
                <option value="">Choose…</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Received into" required errors={f.errors("depositAccountId")}>
            {(p) => (
              <Select
                name="depositAccountId"
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
          <Field label="Date received" required errors={f.errors("date")}>
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
          <Field label={`Amount received (${currency})`} required errors={f.errors("amount")}>
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
          {foreign ? (
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
          ) : (
            <>
              <Field
                label="TDS deducted"
                description="Tax the client withheld"
                errors={f.errors("tds")}
              >
                {(p) => (
                  <Input
                    name="tds"
                    inputMode="decimal"
                    className="tabular"
                    value={tds}
                    onChange={(e) => setTds(e.target.value)}
                    {...p}
                  />
                )}
              </Field>
              <Field label="TDS section" errors={f.errors("tdsSection")}>
                {(p) => (
                  <>
                    <Input
                      name="tdsSection"
                      list="tds-sections"
                      defaultValue={f.value("tdsSection")}
                      {...p}
                    />
                    <datalist id="tds-sections">
                      {Object.entries(tdsSections).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </datalist>
                  </>
                )}
              </Field>
            </>
          )}
        </div>
        <Field label="Notes" errors={f.errors("notes")}>
          {(p) => <Textarea name="notes" defaultValue={f.value("notes")} rows={2} {...p} />}
        </Field>
      </fieldset>

      <fieldset className="flex max-w-3xl flex-col gap-3">
        <legend className="text-md text-text mb-2 font-semibold">Settles</legend>
        {clientId ? (
          <AllocationTable
            invoices={open}
            currency={currency}
            amounts={allocations}
            onChange={(next) => {
              setAllocations(next);
              markDirty();
            }}
            available={available}
            errors={f.errors}
          />
        ) : (
          <p className="text-secondary text-sm">Choose the client to see their open invoices.</p>
        )}
      </fieldset>

      <div className="bg-surface border-separator sticky bottom-0 -mx-4 flex gap-2 border-t px-4 py-3">
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Recording…" : "Record receipt"}
        </Button>
        <Button asChild variant="quiet">
          <Link href={cancelHref}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
