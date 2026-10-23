"use client";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

export function QuoteSettingsForm({
  action,
  defaults,
  baseCurrency,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults: Record<string, string>;
  baseCurrency: string;
}) {
  const f = useForm(action, defaults);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The rules weren't saved" success="Quote rules saved" />
      <label className="text-text flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="requireQuoteApproval"
          defaultChecked={f.value("requireQuoteApproval") === "on"}
        />
        Quotes need the Director&apos;s approval before they are issued
      </label>
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
        <Field
          label={`Only above (${baseCurrency})`}
          description="Leave blank for every quote. Total with tax, converted at the quote's rate"
          errors={f.errors("approvalThreshold")}
        >
          {(p) => (
            <Input
              name="approvalThreshold"
              inputMode="decimal"
              defaultValue={f.value("approvalThreshold")}
              {...p}
            />
          )}
        </Field>
        <Field label="Validity (days)" required errors={f.errors("quoteValidityDays")}>
          {(p) => (
            <Input
              name="quoteValidityDays"
              inputMode="numeric"
              defaultValue={f.value("quoteValidityDays")}
              {...p}
            />
          )}
        </Field>
        <Button type="submit" disabled={f.pending}>
          {f.pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
