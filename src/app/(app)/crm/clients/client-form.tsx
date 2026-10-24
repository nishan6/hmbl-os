"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Alert } from "@/components/ui/page";
import { useForm } from "@/components/ui/use-form";
import { useUnsavedChangesWarning } from "@/components/ui/use-unsaved-changes";
import { CLIENT_KINDS } from "@/server/crm/schemas";
import type { FormState } from "@/server/http/action-result";

export function ClientForm({
  action,
  defaults,
  users,
  submitLabel,
  cancelHref,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults: Record<string, string>;
  users: { id: string; name: string }[];
  submitLabel: string;
  cancelHref: string;
}) {
  const f = useForm(action, defaults);
  const markDirty = useUnsavedChangesWarning(f.state);
  const duplicates = f.errors("duplicate");

  return (
    <form
      action={f.action}
      onChange={markDirty}
      key={f.formKey}
      className="max-w-form flex flex-col gap-6"
      noValidate
    >
      <FormAlert {...f} title="The client wasn't saved" />
      {duplicates ? (
        <Alert tone="warning" title="Possible duplicate">
          <p>Similar clients already exist: {duplicates.join(", ")}.</p>
          <label className="mt-2 flex items-center gap-2">
            <input type="checkbox" name="allowDuplicate" className="size-4" />
            This is a different organisation. Create it anyway.
          </label>
        </Alert>
      ) : null}

      <fieldset className="flex flex-col gap-4">
        <legend className="text-md text-text mb-2 font-semibold">Client</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name" required errors={f.errors("name")} className="sm:col-span-2">
            {(p) => <Input name="name" defaultValue={f.value("name")} {...p} />}
          </Field>
          <Field label="Type" errors={f.errors("kind")}>
            {(p) => (
              <Select name="kind" defaultValue={f.value("kind")} {...p}>
                {Object.entries(CLIENT_KINDS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Registered legal name" errors={f.errors("legalName")}>
            {(p) => <Input name="legalName" defaultValue={f.value("legalName")} {...p} />}
          </Field>
          <Field label="Industry" errors={f.errors("industry")}>
            {(p) => <Input name="industry" defaultValue={f.value("industry")} {...p} />}
          </Field>
          <Field label="Website" errors={f.errors("website")}>
            {(p) => <Input name="website" defaultValue={f.value("website")} {...p} />}
          </Field>
          <Field label="Account owner" errors={f.errors("ownerId")}>
            {(p) => (
              <Select name="ownerId" defaultValue={f.value("ownerId")} {...p}>
                <option value="">Nobody</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Email" errors={f.errors("email")}>
            {(p) => <Input name="email" type="email" defaultValue={f.value("email")} {...p} />}
          </Field>
          <Field label="Phone" errors={f.errors("phone")}>
            {(p) => <Input name="phone" type="tel" defaultValue={f.value("phone")} {...p} />}
          </Field>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-md text-text mb-2 font-semibold">Billing and tax</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Tax ID type"
            description="e.g. GSTIN, VAT, TRN"
            errors={f.errors("taxIdType")}
          >
            {(p) => <Input name="taxIdType" defaultValue={f.value("taxIdType")} {...p} />}
          </Field>
          <Field label="Tax ID" errors={f.errors("taxId")} className="sm:col-span-2">
            {(p) => <Input name="taxId" defaultValue={f.value("taxId")} {...p} />}
          </Field>
        </div>
        <Field label="Address line 1" errors={f.errors("addressLine1")}>
          {(p) => <Input name="addressLine1" defaultValue={f.value("addressLine1")} {...p} />}
        </Field>
        <Field label="Address line 2" errors={f.errors("addressLine2")}>
          {(p) => <Input name="addressLine2" defaultValue={f.value("addressLine2")} {...p} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="City" errors={f.errors("city")}>
            {(p) => <Input name="city" defaultValue={f.value("city")} {...p} />}
          </Field>
          <Field
            label="State or region"
            description="For India, the GST state"
            errors={f.errors("region")}
          >
            {(p) => <Input name="region" defaultValue={f.value("region")} {...p} />}
          </Field>
          <Field label="Postal code" errors={f.errors("postalCode")}>
            {(p) => <Input name="postalCode" defaultValue={f.value("postalCode")} {...p} />}
          </Field>
          <Field
            label="Country"
            required
            description="ISO code, e.g. IN"
            errors={f.errors("countryCode")}
          >
            {(p) => (
              <Input
                name="countryCode"
                defaultValue={f.value("countryCode")}
                maxLength={2}
                {...p}
              />
            )}
          </Field>
          <Field
            label="Quote currency"
            required
            description="ISO code, e.g. INR"
            errors={f.errors("currency")}
          >
            {(p) => (
              <Input name="currency" defaultValue={f.value("currency")} maxLength={3} {...p} />
            )}
          </Field>
          <Field
            label="Invoice code"
            description="In invoice numbers, e.g. MAG. Blank for one-off clients, who share INT"
            errors={f.errors("invoiceCode")}
          >
            {(p) => (
              <Input
                name="invoiceCode"
                defaultValue={f.value("invoiceCode")}
                maxLength={6}
                className="font-mono uppercase"
                {...p}
              />
            )}
          </Field>
        </div>
      </fieldset>

      <Field label="Notes" errors={f.errors("notes")}>
        {(p) => <Textarea name="notes" defaultValue={f.value("notes")} rows={3} {...p} />}
      </Field>

      <div className="border-separator flex items-center gap-2 border-t pt-4">
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Saving…" : submitLabel}
        </Button>
        <Button asChild variant="quiet">
          <Link href={cancelHref}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
