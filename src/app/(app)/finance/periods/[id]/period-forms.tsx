"use client";

import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** Closes a period, with a note when warnings are open. */
export function ClosePeriodForm({
  action,
  name,
  warnings,
}: {
  action: Action;
  name: string;
  warnings: number;
}) {
  const f = useForm(action);
  return (
    <form
      action={f.action}
      key={f.formKey}
      className="flex flex-col gap-3"
      noValidate
      onSubmit={(e) => {
        if (!window.confirm(`Close ${name}? Nothing can then be posted into it.`))
          e.preventDefault();
      }}
    >
      <FormAlert {...f} title="The period wasn't closed" />
      <Field
        label={warnings ? "Why it can close with the warnings open" : "Note"}
        required={warnings > 0}
        errors={f.errors("note")}
      >
        {(p) => <Textarea name="note" rows={2} defaultValue={f.value("note")} {...p} />}
      </Field>
      <div>
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Closing…" : `Close ${name}`}
        </Button>
      </div>
    </form>
  );
}

/** Reopens a closed period, with a reason. */
export function ReopenPeriodForm({ action, name }: { action: Action; name: string }) {
  const f = useForm(action);
  return (
    <form
      action={f.action}
      key={f.formKey}
      className="flex flex-col gap-3"
      noValidate
      onSubmit={(e) => {
        if (!window.confirm(`Reopen ${name}? Postings into it will be allowed again.`))
          e.preventDefault();
      }}
    >
      <FormAlert {...f} title="The period wasn't reopened" />
      <Field label="Reason" required errors={f.errors("reason")}>
        {(p) => <Input name="reason" defaultValue={f.value("reason")} {...p} />}
      </Field>
      <div>
        <Button type="submit" variant="destructive" disabled={f.pending}>
          {f.pending ? "Reopening…" : `Reopen ${name}`}
        </Button>
      </div>
    </form>
  );
}
