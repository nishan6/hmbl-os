"use client";

import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

/** What every printed invoice carries: terms, contact block, website and signatory. */
export function InvoiceLayoutForm({
  action,
  defaults,
  disabled,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults: Record<string, string>;
  disabled?: boolean;
}) {
  const f = useForm(action, defaults);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-4" noValidate>
      <FormAlert {...f} title="The invoice layout wasn't saved" />
      <fieldset disabled={disabled} className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Default terms"
          description="One per line. New invoices start with these, and each invoice can change its own. The GST and SAC lines are added for you."
          errors={f.errors("invoiceTerms")}
          className="sm:col-span-2"
        >
          {(p) => (
            <Textarea
              name="invoiceTerms"
              rows={3}
              defaultValue={f.value("invoiceTerms")}
              placeholder="50% payment to be paid before the commencement of work."
              {...p}
            />
          )}
        </Field>
        <Field
          label="Contact block"
          description="Address, phone numbers and email, one per line."
          errors={f.errors("invoiceContact")}
        >
          {(p) => (
            <Textarea
              name="invoiceContact"
              rows={4}
              defaultValue={f.value("invoiceContact")}
              {...p}
            />
          )}
        </Field>
        <div className="flex flex-col gap-4">
          <Field label="Signed by" errors={f.errors("invoiceSignatoryName")}>
            {(p) => (
              <Input
                name="invoiceSignatoryName"
                defaultValue={f.value("invoiceSignatoryName")}
                {...p}
              />
            )}
          </Field>
          <Field label="Their role" errors={f.errors("invoiceSignatoryTitle")}>
            {(p) => (
              <Input
                name="invoiceSignatoryTitle"
                defaultValue={f.value("invoiceSignatoryTitle")}
                {...p}
              />
            )}
          </Field>
          <Field label="Website" errors={f.errors("invoiceWebsite")}>
            {(p) => <Input name="invoiceWebsite" defaultValue={f.value("invoiceWebsite")} {...p} />}
          </Field>
        </div>
      </fieldset>
      {disabled ? null : (
        <div>
          <Button type="submit" variant="primary" disabled={f.pending}>
            {f.pending ? "Saving…" : "Save invoice layout"}
          </Button>
        </div>
      )}
    </form>
  );
}
