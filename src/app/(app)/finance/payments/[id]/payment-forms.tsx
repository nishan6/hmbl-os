"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";
import {
  AllocationTable,
  allocationPayload,
  type OpenDocument,
} from "../../_components/allocation-table";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** Sets an advance against the vendor's approved bills. */
export function AllocatePaymentForm({
  action,
  bills,
  currency,
  available,
  defaultDate,
}: {
  action: Action;
  bills: OpenDocument[];
  currency: string;
  available: bigint;
  defaultDate: string;
}) {
  const f = useForm(action, { date: defaultDate });
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="Nothing was allocated" />
      <input type="hidden" name="allocations" value={allocationPayload(bills, amounts, "billId")} />
      <Field label="Date" required errors={f.errors("date")} className="max-w-48">
        {(p) => <Input type="date" name="date" defaultValue={f.value("date")} {...p} />}
      </Field>
      <AllocationTable
        invoices={bills}
        currency={currency}
        amounts={amounts}
        onChange={setAmounts}
        available={available}
        errors={f.errors}
        noun="bill"
        remainder="Advance"
      />
      {bills.length ? (
        <div>
          <Button type="submit" variant="primary" disabled={f.pending}>
            {f.pending ? "Allocating…" : "Allocate"}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

/** Voids a payment on a date, with a reason. */
export function VoidPaymentForm({ action, defaultDate }: { action: Action; defaultDate: string }) {
  const f = useForm(action, { date: defaultDate });
  return (
    <form
      action={f.action}
      key={f.formKey}
      className="flex flex-col gap-3"
      noValidate
      onSubmit={(e) => {
        if (
          !window.confirm("Void this payment? Its journals are reversed and its bills reopened.")
        ) {
          e.preventDefault();
        }
      }}
    >
      <FormAlert {...f} title="The payment wasn't voided" />
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
          {f.pending ? "Voiding…" : "Void payment"}
        </Button>
      </div>
    </form>
  );
}
