"use client";

import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

export function MergeForm({
  action,
  clients,
  name,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  clients: { id: string; name: string }[];
  name: string;
}) {
  const f = useForm(action);
  return (
    <form
      action={f.action}
      key={f.formKey}
      onSubmit={(e) => {
        if (!window.confirm(`Merge ${name} into the selected client? This can't be undone.`)) {
          e.preventDefault();
        }
      }}
      className="flex flex-col gap-3"
      noValidate
    >
      <FormAlert {...f} title="The clients weren't merged" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Keep this client" required errors={f.errors("targetId")}>
          {(p) => (
            <Select name="targetId" defaultValue={f.value("targetId")} {...p}>
              <option value="">Choose…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Reason" required errors={f.errors("reason")}>
          {(p) => (
            <Input
              name="reason"
              defaultValue={f.value("reason")}
              placeholder="e.g. Entered twice"
              {...p}
            />
          )}
        </Field>
      </div>
      <div>
        <Button type="submit" variant="destructive" disabled={f.pending}>
          {f.pending ? "Merging…" : "Merge and archive this client"}
        </Button>
      </div>
    </form>
  );
}
