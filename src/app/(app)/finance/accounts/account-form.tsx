"use client";

import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import { ACCOUNT_SUBTYPES, ACCOUNT_TYPES } from "@/server/finance/accounts-default";
import type { FormState } from "@/server/http/action-result";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** Code, name and statement heading of a ledger account. */
export function AccountForm({
  action,
  defaults = {},
  submitLabel,
}: {
  action: Action;
  defaults?: Record<string, string>;
  submitLabel: string;
}) {
  const f = useForm(action, defaults);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The account wasn't saved" />
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr_14rem]">
        <Field label="Code" required errors={f.errors("code")}>
          {(p) => <Input name="code" defaultValue={f.value("code")} className="tabular" {...p} />}
        </Field>
        <Field label="Name" required errors={f.errors("name")}>
          {(p) => <Input name="name" defaultValue={f.value("name")} {...p} />}
        </Field>
        <Field label="Heading" required errors={f.errors("subtype")}>
          {(p) => (
            <Select name="subtype" defaultValue={f.value("subtype")} {...p}>
              <option value="">Choose…</option>
              {Object.entries(ACCOUNT_TYPES).map(([type, { label }]) => (
                <optgroup key={type} label={label}>
                  {Object.entries(ACCOUNT_SUBTYPES)
                    .filter(([, s]) => s.type === type)
                    .map(([value, s]) => (
                      <option key={value} value={value}>
                        {s.label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Description" errors={f.errors("description")}>
        {(p) => <Input name="description" defaultValue={f.value("description")} {...p} />}
      </Field>
      <div>
        <Button
          type="submit"
          variant={defaults.code ? "secondary" : "primary"}
          disabled={f.pending}
        >
          {f.pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
