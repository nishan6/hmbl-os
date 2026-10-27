"use client";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

/** Changes the signed-in person's password. */
export function ChangePassword({
  action,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const f = useForm(action);
  return (
    <form action={f.action} key={f.formKey} className="max-w-form flex flex-col gap-4" noValidate>
      <FormAlert {...f} title="Your password wasn't changed" />
      <Field label="Current password" required errors={f.errors("current")}>
        {(p) => <Input name="current" type="password" autoComplete="current-password" {...p} />}
      </Field>
      <Field
        label="New password"
        description="At least 12 characters."
        required
        errors={f.errors("password")}
      >
        {(p) => <Input name="password" type="password" autoComplete="new-password" {...p} />}
      </Field>
      <Field label="Type it again" required errors={f.errors("confirm")}>
        {(p) => <Input name="confirm" type="password" autoComplete="new-password" {...p} />}
      </Field>
      <div>
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Changing…" : "Change password"}
        </Button>
      </div>
    </form>
  );
}
