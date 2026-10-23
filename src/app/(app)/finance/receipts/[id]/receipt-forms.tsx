"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";
import { AllocationTable, allocationPayload, type OpenInvoice } from "../allocation-table";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** Applies what a receipt holds on account to open invoices. */
export function AllocateForm({
  action,
  invoices,
  currency,
  available,
  defaultDate,
}: {
  action: Action;
  invoices: OpenInvoice[];
  currency: string;
  available: bigint;
  defaultDate: string;
}) {
  const f = useForm(action, { date: defaultDate });
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="Nothing was allocated" />
      <input type="hidden" name="allocations" value={allocationPayload(invoices, amounts)} />
      <Field label="Date" required errors={f.errors("date")} className="max-w-48">
        {(p) => <Input type="date" name="date" defaultValue={f.value("date")} {...p} />}
      </Field>
      <AllocationTable
        invoices={invoices}
        currency={currency}
        amounts={amounts}
        onChange={setAmounts}
        available={available}
        errors={f.errors}
      />
      {invoices.length ? (
        <div>
          <Button type="submit" variant="primary" disabled={f.pending}>
            {f.pending ? "Allocating…" : "Allocate"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

/** Voids a receipt on a date, with a reason. */
export function VoidReceiptForm({ action, defaultDate }: { action: Action; defaultDate: string }) {
  const f = useForm(action, { date: defaultDate });
  return (
    <form
      action={f.action}
      key={f.formKey}
      className="flex flex-col gap-3"
      noValidate
      onSubmit={(e) => {
        if (
          !window.confirm("Void this receipt? Its journals are reversed and its invoices reopened.")
        ) {
          e.preventDefault();
        }
      }}
    >
      <FormAlert {...f} title="The receipt wasn't voided" />
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <Field label="Void date" required errors={f.errors("date")}>
          {(p) => <Input type="date" name="date" defaultValue={f.value("date")} {...p} />}
        </Field>
        <Field label="Reason" required errors={f.errors("reason")}>
          {(p) => <Input name="reason" defaultValue={f.value("reason")} {...p} />}
        </Field>
      </div>
      <div>
        <Button type="submit" variant="destructive" disabled={f.pending}>
          {f.pending ? "Voiding…" : "Void receipt"}
        </Button>
      </div>
    </form>
  );
}
