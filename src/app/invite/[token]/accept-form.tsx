"use client";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import { acceptInvitationAction } from "./actions";

export function AcceptForm({ token, name }: { token: string; name: string }) {
  const f = useForm(acceptInvitationAction.bind(null, token), { name });
  return (
    <form action={f.action} key={f.formKey} className="mt-5 flex flex-col gap-4" noValidate>
      <FormAlert {...f} title="Your account wasn't created" />
      <Field
        label="Your email address"
        description="The address HMBL invited. It becomes your sign-in."
        required
        errors={f.errors("email")}
      >
        {(p) => (
          <Input
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={f.value("email")}
            {...p}
          />
        )}
      </Field>
      <Field label="Your name" required errors={f.errors("name")}>
        {(p) => <Input name="name" autoComplete="name" defaultValue={f.value("name")} {...p} />}
      </Field>
      <Field
        label="Choose a password"
        description="At least 12 characters."
        required
        errors={f.errors("password")}
      >
        {(p) => <Input name="password" type="password" autoComplete="new-password" {...p} />}
      </Field>
      <Field label="Type it again" required errors={f.errors("confirm")}>
        {(p) => <Input name="confirm" type="password" autoComplete="new-password" {...p} />}
      </Field>
      <Button type="submit" variant="primary" disabled={f.pending}>
        {f.pending ? "Creating your account…" : "Create my account"}
      </Button>
    </form>
  );
}
