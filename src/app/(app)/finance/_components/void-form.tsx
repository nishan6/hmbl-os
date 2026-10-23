"use client";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** Voids something on a date, with a reason, after a confirmation. */
export function VoidForm({
  action,
  defaultDate,
  confirm,
  label,
  failure,
}: {
  action: Action;
  defaultDate: string;
  confirm: string;
  label: string;
  failure: string;
}) {
  const f = useForm(action, { date: defaultDate });
  return (
    <form
      action={f.action}
      key={f.formKey}
      className="flex flex-col gap-3"
      noValidate
      onSubmit={(e) => {
        if (!window.confirm(confirm)) e.preventDefault();
      }}
    >
      <FormAlert {...f} title={failure} />
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
          {f.pending ? "Voiding…" : label}
        </Button>
      </div>
    </form>
  );
}
