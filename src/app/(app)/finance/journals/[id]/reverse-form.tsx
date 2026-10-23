"use client";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

/** Reverses a posted journal on a date, with a reason. */
export function ReverseForm({
  action,
  defaultDate,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaultDate: string;
}) {
  const f = useForm(action, { date: defaultDate });
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The journal wasn't reversed" />
      <input type="hidden" name="command" value="reverse" />
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <Field label="Reversal date" required errors={f.errors("date")}>
          {(p) => <Input type="date" name="date" defaultValue={f.value("date")} {...p} />}
        </Field>
        <Field label="Reason" required errors={f.errors("reason")}>
          {(p) => <Input name="reason" defaultValue={f.value("reason")} {...p} />}
        </Field>
      </div>
      <div>
        <Button type="submit" variant="destructive" disabled={f.pending}>
          {f.pending ? "Reversing…" : "Reverse journal"}
        </Button>
      </div>
    </form>
  );
}
