"use client";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

/** A vendor's identity, tax numbers, terms and bank details. */
export function VendorForm({
  action,
  defaults,
  kinds,
  tdsSections,
  submitLabel,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults: Record<string, string>;
  kinds: Record<string, string>;
  tdsSections: Record<string, string>;
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
    <form action={f.action} key={f.formKey} className="flex max-w-3xl flex-col gap-6" noValidate>
      <FormAlert {...f} title="The vendor wasn't saved" />
      <fieldset className="flex flex-col gap-3">
        <legend className="text-md text-text mb-2 font-semibold">Vendor</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {text("name", "Name", { required: true })}
          {text("legalName", "Legal name", { description: "As on their invoices" })}
          <Field label="Kind" errors={f.errors("kind")}>
            {(p) => (
              <Select name="kind" defaultValue={f.value("kind") || "COMPANY"} {...p}>
                {Object.entries(kinds).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {text("email", "Email")}
          {text("phone", "Phone")}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-md text-text mb-2 font-semibold">Tax</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {text("gstin", "GSTIN", { className: "tabular uppercase" })}
          {text("pan", "PAN", {
            description: "Taken from the GSTIN when blank",
            className: "tabular uppercase",
          })}
          {text("msmeNumber", "Udyam (MSME) number", {
            description: "MSME suppliers are paid within 45 days",
            className: "uppercase",
          })}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label="Usual TDS section"
            description="Filled into their bills"
            errors={f.errors("tdsSection")}
          >
            {(p) => (
              <>
                <Input
                  name="tdsSection"
                  list="vendor-tds-sections"
                  defaultValue={f.value("tdsSection")}
                  {...p}
                />
                <datalist id="vendor-tds-sections">
                  {Object.entries(tdsSections).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </datalist>
              </>
            )}
          </Field>
          {text("tdsRate", "TDS rate (%)", {
            description: "20% when they have given no PAN",
            className: "tabular",
          })}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-md text-text mb-2 font-semibold">Address and terms</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {text("addressLine1", "Address")}
          {text("addressLine2", "Address line 2")}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {text("city", "City")}
          {text("region", "State", { description: "Sets GST when there is no GSTIN" })}
          {text("postalCode", "PIN code", { className: "tabular" })}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {text("countryCode", "Country", {
            required: true,
            description: "Two-letter code, such as IN",
            className: "uppercase",
          })}
          {text("currency", "Currency", { required: true, className: "uppercase" })}
          {text("paymentTermsDays", "Payment terms (days)", {
            required: true,
            className: "tabular",
          })}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-md text-text mb-2 font-semibold">Bank details</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {text("bankAccountName", "Account name")}
          {text("bankAccountNumber", "Account number", { className: "tabular" })}
          {text("bankIfsc", "IFSC", { className: "tabular uppercase" })}
        </div>
      </fieldset>
      <Field label="Notes" errors={f.errors("notes")}>
        {(p) => <Textarea name="notes" defaultValue={f.value("notes")} rows={2} {...p} />}
      </Field>
      <div>
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
