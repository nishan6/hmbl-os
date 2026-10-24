"use client";

import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

function Submit({ pending, label }: { pending: boolean; label: string }) {
  return (
    <div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : label}
      </Button>
    </div>
  );
}

/** A new rate; an open rate of the same kind ends the day before it starts. */
export function RateForm({
  action,
  types,
  defaults,
}: {
  action: Action;
  types: Record<string, string>;
  defaults: Record<string, string>;
}) {
  const f = useForm(action, defaults);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The rate wasn't added" />
      <div className="grid gap-3 sm:grid-cols-[1fr_2fr_1fr_1fr]">
        <Field label="Type" required errors={f.errors("type")}>
          {(p) => (
            <Select name="type" defaultValue={f.value("type") || "DAY"} {...p}>
              {Object.entries(types).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="For role" description="Blank for any role" errors={f.errors("role")}>
          {(p) => <Input name="role" defaultValue={f.value("role")} {...p} />}
        </Field>
        <Field label="Currency" required errors={f.errors("currency")}>
          {(p) => (
            <Input
              name="currency"
              className="uppercase"
              defaultValue={f.value("currency")}
              {...p}
            />
          )}
        </Field>
        <Field label="Amount" required errors={f.errors("amount")}>
          {(p) => (
            <Input
              name="amount"
              inputMode="decimal"
              className="tabular"
              defaultValue={f.value("amount")}
              {...p}
            />
          )}
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_3fr]">
        <Field label="From" required errors={f.errors("validFrom")}>
          {(p) => <Input name="validFrom" type="date" defaultValue={f.value("validFrom")} {...p} />}
        </Field>
        <Field label="Notes" errors={f.errors("notes")}>
          {(p) => <Input name="notes" defaultValue={f.value("notes")} {...p} />}
        </Field>
      </div>
      <Submit pending={f.pending} label="Add rate" />
    </form>
  );
}

/** Ends a rate on a date. */
export function EndRateForm({ action, rateId }: { action: Action; rateId: string }) {
  const f = useForm(action);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-2" noValidate>
      <FormAlert {...f} title="The rate wasn't ended" />
      <input type="hidden" name="rateId" value={rateId} />
      <div className="flex items-end gap-2">
        <Field label="Last day" errors={f.errors("validTo")}>
          {(p) => <Input name="validTo" type="date" className="w-40" {...p} />}
        </Field>
        <Button type="submit" size="sm" disabled={f.pending}>
          End rate
        </Button>
      </div>
    </form>
  );
}

export function CertificationForm({ action }: { action: Action }) {
  const f = useForm(action);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The certification wasn't added" />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Name" required description="e.g. Working at height" errors={f.errors("name")}>
          {(p) => <Input name="name" defaultValue={f.value("name")} {...p} />}
        </Field>
        <Field label="Issued by" errors={f.errors("issuer")}>
          {(p) => <Input name="issuer" defaultValue={f.value("issuer")} {...p} />}
        </Field>
        <Field label="Number" errors={f.errors("reference")}>
          {(p) => <Input name="reference" defaultValue={f.value("reference")} {...p} />}
        </Field>
        <Field label="Issued on" errors={f.errors("issuedOn")}>
          {(p) => <Input name="issuedOn" type="date" defaultValue={f.value("issuedOn")} {...p} />}
        </Field>
        <Field label="Expires on" errors={f.errors("expiresOn")}>
          {(p) => <Input name="expiresOn" type="date" defaultValue={f.value("expiresOn")} {...p} />}
        </Field>
      </div>
      <Submit pending={f.pending} label="Add certification" />
    </form>
  );
}

export function UnavailabilityForm({ action }: { action: Action }) {
  const f = useForm(action);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The time off wasn't added" />
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr]">
        <Field label="From" required errors={f.errors("startDate")}>
          {(p) => <Input name="startDate" type="date" defaultValue={f.value("startDate")} {...p} />}
        </Field>
        <Field label="To" description="Blank for one day" errors={f.errors("endDate")}>
          {(p) => <Input name="endDate" type="date" defaultValue={f.value("endDate")} {...p} />}
        </Field>
        <Field label="Reason" description="e.g. Leave, another job" errors={f.errors("reason")}>
          {(p) => <Input name="reason" defaultValue={f.value("reason")} {...p} />}
        </Field>
      </div>
      <Submit pending={f.pending} label="Add time off" />
    </form>
  );
}
