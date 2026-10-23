"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

export function ContactForm({
  action,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const f = useForm(action);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The contact wasn't added" success="Contact added" />
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Contact name" required errors={f.errors("name")}>
          {(p) => <Input name="name" defaultValue={f.value("name")} {...p} />}
        </Field>
        <Field label="Job title" errors={f.errors("jobTitle")}>
          {(p) => <Input name="jobTitle" defaultValue={f.value("jobTitle")} {...p} />}
        </Field>
        <Field label="Contact email" errors={f.errors("email")}>
          {(p) => <Input name="email" type="email" defaultValue={f.value("email")} {...p} />}
        </Field>
        <Field label="Contact phone" errors={f.errors("phone")}>
          {(p) => <Input name="phone" type="tel" defaultValue={f.value("phone")} {...p} />}
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="text-text flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="isPrimary"
            defaultChecked={f.value("isPrimary") === "on"}
            className="size-4"
          />
          Primary contact
        </label>
        <Button type="submit" disabled={f.pending}>
          <Plus aria-hidden />
          {f.pending ? "Adding…" : "Add contact"}
        </Button>
      </div>
    </form>
  );
}
