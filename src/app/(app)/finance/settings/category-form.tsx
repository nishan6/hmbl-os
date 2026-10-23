"use client";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

/** One expense category: its name, ledger account, per-line limit and receipt rule. */
export function CategoryForm({
  action,
  defaults,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults: Record<string, string>;
}) {
  const f = useForm(action, defaults);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The category wasn't saved" />
      <div className="grid gap-3 sm:grid-cols-[1fr_8rem_10rem]">
        <Field label="Name" required errors={f.errors("name")}>
          {(p) => <Input name="name" defaultValue={f.value("name")} {...p} />}
        </Field>
        <Field label="Account code" required errors={f.errors("accountCode")}>
          {(p) => (
            <Input
              name="accountCode"
              inputMode="numeric"
              className="tabular"
              defaultValue={f.value("accountCode")}
              {...p}
            />
          )}
        </Field>
        <Field
          label="Limit per expense (INR)"
          description="Blank for none"
          errors={f.errors("limit")}
        >
          {(p) => (
            <Input
              name="limit"
              inputMode="decimal"
              className="tabular text-right"
              defaultValue={f.value("limit")}
              {...p}
            />
          )}
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name="receiptRequired"
            defaultChecked={f.value("receiptRequired") === "true"}
          />
          Needs a receipt
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="archived" defaultChecked={f.value("archived") === "true"} />
          Archived
        </label>
        <Button type="submit" disabled={f.pending}>
          {f.pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
