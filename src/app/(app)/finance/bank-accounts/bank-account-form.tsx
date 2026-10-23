"use client";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

/** A bank account's details, as printed on invoices. */
export function BankAccountForm({
  action,
  defaults,
  submitLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults: Record<string, string>;
  submitLabel: string;
}) {
  const f = useForm(action, defaults);
  const text = (
    name: string,
    label: string,
    options: { required?: boolean; description?: string; className?: string } = {},
  ) => (
    <Field
      label={label}
      required={options.required}
      description={options.description}
      errors={f.errors(name)}
    >
      {(p) => (
        <Input name={name} defaultValue={f.value(name)} className={options.className} {...p} />
      )}
    </Field>
  );
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The bank account wasn't saved" />
      <div className="grid gap-3 sm:grid-cols-2">
        {text("bankName", "Bank", { required: true })}
        {text("branch", "Branch")}
        {text("accountName", "Account name", { required: true })}
        {text("accountNumber", "Account number", { required: true, className: "tabular" })}
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {text("currency", "Currency", { required: true, className: "uppercase" })}
        {text("ifsc", "IFSC", { description: "Indian accounts", className: "tabular uppercase" })}
        {text("swift", "SWIFT/BIC", { className: "tabular uppercase" })}
        {text("iban", "IBAN", { className: "tabular uppercase" })}
      </div>
      <label className="text-text flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="showOnInvoices"
          defaultChecked={["on", "true"].includes(f.value("showOnInvoices"))}
        />
        Print on invoices in this currency, for clients to pay into
      </label>
      <div>
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
