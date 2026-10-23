"use client";

import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

export function SettingsForm({
  action,
  defaults,
  options,
  disabled,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults: Record<string, string>;
  options: Record<string, string>;
  disabled: boolean;
}) {
  const f = useForm(action, defaults);
  return (
    <form action={f.action} key={f.formKey} className="max-w-form flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The settings weren't saved" />
      <Field
        label="Revenue recognition"
        description="When invoiced amounts count as revenue. On completion holds them as client advances until the project is completed."
        errors={f.errors("revenueRecognition")}
      >
        {(p) => (
          <Select
            name="revenueRecognition"
            defaultValue={f.value("revenueRecognition")}
            disabled={disabled}
            {...p}
          >
            {Object.entries(options).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {disabled ? null : (
        <div>
          <Button type="submit" disabled={f.pending}>
            {f.pending ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </form>
  );
}
