"use client";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import { redeemLinkAction } from "./actions";

export function LinkForm({
  token,
  name,
  invite,
}: {
  token: string;
  name: string;
  invite: boolean;
}) {
  const f = useForm(redeemLinkAction.bind(null, token), { name });
  return (
    <form action={f.action} key={f.formKey} className="mt-5 flex flex-col gap-4" noValidate>
      <FormAlert
        {...f}
        title={invite ? "Your account wasn't created" : "Your password wasn't changed"}
      />
      <Field
        label="Your email address"
        description={
          invite
            ? "The address you were invited with. It becomes your sign-in."
            : "The address you sign in with."
        }
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
      {invite ? (
        <Field label="Your name" required errors={f.errors("name")}>
          {(p) => <Input name="name" autoComplete="name" defaultValue={f.value("name")} {...p} />}
        </Field>
      ) : null}
      <Field
        label={invite ? "Choose a password" : "New password"}
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
        {f.pending ? "Saving…" : invite ? "Create my account" : "Set my password"}
      </Button>
    </form>
  );
}
