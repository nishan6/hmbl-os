"use client";

import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

/** Records unspent advance money handed back into a bank or cash account. */
export function ReturnAdvanceForm({
  action,
  accounts,
  currency,
  defaults,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  accounts: { id: string; code: string; name: string }[];
  currency: string;
  defaults: Record<string, string>;
}) {
  const f = useForm(action, defaults);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The return wasn't recorded" />
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr_10rem]">
        <Field label="Date" required errors={f.errors("date")}>
          {(p) => <Input type="date" name="date" defaultValue={f.value("date")} {...p} />}
        </Field>
        <Field label="Paid into" required errors={f.errors("depositAccountId")}>
          {(p) => (
            <Select name="depositAccountId" defaultValue={f.value("depositAccountId")} {...p}>
              <option value="">Choose…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={`Amount (${currency})`} required errors={f.errors("amount")}>
          {(p) => (
            <Input
              name="amount"
              inputMode="decimal"
              className="tabular text-right"
              defaultValue={f.value("amount")}
              {...p}
            />
          )}
        </Field>
      </div>
      <Field label="Reference" errors={f.errors("reference")}>
        {(p) => (
          <Input name="reference" defaultValue={f.value("reference")} className="max-w-xs" {...p} />
        )}
      </Field>
      <div>
        <Button type="submit" disabled={f.pending}>
          {f.pending ? "Recording…" : "Record money returned"}
        </Button>
      </div>
    </form>
  );
}
