"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

export type StatusOption = { value: string; label: string; needsReason: boolean };

/** Moves the project to another status. The server re-checks the move. */
export function StatusForm({
  action,
  options,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  options: StatusOption[];
}) {
  const f = useForm(action, { to: options[0]?.value ?? "" });
  const [to, setTo] = useState(f.value("to"));
  const needsReason = options.find((o) => o.value === to)?.needsReason ?? false;
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The status wasn't changed" />
      <Field label="Move to" errors={f.errors("to")}>
        {(p) => (
          <Select
            name="to"
            defaultValue={f.value("to")}
            onChange={(e) => setTo(e.target.value)}
            {...p}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label="Reason"
        required={needsReason}
        description={needsReason ? "Kept in the status history" : "Optional"}
        errors={f.errors("reason")}
      >
        {(p) => <Textarea name="reason" rows={2} defaultValue={f.value("reason")} {...p} />}
      </Field>
      <div>
        <Button type="submit" disabled={f.pending}>
          {f.pending ? "Saving…" : "Change status"}
        </Button>
      </div>
    </form>
  );
}
