"use client";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

/**
 * A service in invoice numbers. New ones take a code; an existing one shows
 * its code, which never changes, and can be renamed or archived.
 */
export function ServiceForm({
  action,
  defaults,
  code,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults: Record<string, string>;
  /** The existing service's code; absent when adding one. */
  code?: string;
}) {
  const f = useForm(action, defaults);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The service wasn't saved" />
      <div className="flex flex-wrap items-end gap-3">
        {code ? (
          <p className="w-24 pb-2 font-mono font-semibold">{code}</p>
        ) : (
          <Field label="Code" required description="2–6 capitals" errors={f.errors("code")}>
            {(p) => (
              <Input
                name="code"
                maxLength={6}
                className="w-24 font-mono uppercase"
                defaultValue={f.value("code")}
                {...p}
              />
            )}
          </Field>
        )}
        <Field label="Name" required errors={f.errors("name")} className="min-w-60 flex-1">
          {(p) => <Input name="name" defaultValue={f.value("name")} {...p} />}
        </Field>
        {code ? (
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              name="archived"
              defaultChecked={f.value("archived") === "true"}
            />
            Archived
          </label>
        ) : null}
        <Button type="submit" disabled={f.pending}>
          {f.pending ? "Saving…" : code ? "Save" : "Add service"}
        </Button>
      </div>
    </form>
  );
}
