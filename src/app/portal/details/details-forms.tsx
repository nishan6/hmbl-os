"use client";

import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import { requestDetailsAction, updateDetailsAction } from "../actions";

export function DetailsForm({
  fields,
  defaults,
}: {
  fields: { name: string; label: string }[];
  defaults: Record<string, string>;
}) {
  const f = useForm(updateDetailsAction, defaults);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="Your details weren't saved" />
      {fields.map((field) => (
        <Field key={field.name} label={field.label} errors={f.errors(field.name)}>
          {(p) => (
            <Input
              name={field.name}
              type={field.name === "email" ? "email" : "text"}
              defaultValue={f.value(field.name)}
              {...p}
            />
          )}
        </Field>
      ))}
      <Button type="submit" variant="primary" disabled={f.pending}>
        {f.pending ? "Saving…" : "Save details"}
      </Button>
    </form>
  );
}

export function RequestForm() {
  const f = useForm(requestDetailsAction);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="Your request wasn't sent" />
      <Field label="What changed" required errors={f.errors("details")}>
        {(p) => <Textarea name="details" rows={4} defaultValue={f.value("details")} {...p} />}
      </Field>
      <Button type="submit" variant="secondary" disabled={f.pending}>
        Send to HMBL
      </Button>
    </form>
  );
}
