"use client";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

export type LineOption = { id: string; label: string; kinds: string[] };

/** A crew role or an equipment item the project needs. */
export function RequirementForm({
  action,
  lines,
  showCosts,
  defaults,
  submitLabel = "Add to plan",
}: {
  action: Action;
  lines: LineOption[];
  showCosts: boolean;
  defaults: Record<string, string>;
  submitLabel?: string;
}) {
  const f = useForm(action, { quantity: "1", ...defaults });
  const kind = defaults.kind ?? "CREW";
  const options = lines.filter((l) => l.kinds.includes(kind));
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The plan wasn't saved" />
      <input type="hidden" name="kind" value={kind} />
      {defaults.requirementId ? (
        <input type="hidden" name="requirementId" value={defaults.requirementId} />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <Field
          label={kind === "CREW" ? "Role" : "Item"}
          required
          description={kind === "CREW" ? "e.g. Lighting operator" : "e.g. LED wall 4×3 m"}
          errors={f.errors("name")}
        >
          {(p) => <Input name="name" defaultValue={f.value("name")} {...p} />}
        </Field>
        <Field label="How many" required errors={f.errors("quantity")}>
          {(p) => (
            <Input
              name="quantity"
              inputMode="numeric"
              className="tabular"
              defaultValue={f.value("quantity")}
              {...p}
            />
          )}
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From" required errors={f.errors("startDate")}>
          {(p) => <Input name="startDate" type="date" defaultValue={f.value("startDate")} {...p} />}
        </Field>
        <Field label="To" description="Blank for one day" errors={f.errors("endDate")}>
          {(p) => <Input name="endDate" type="date" defaultValue={f.value("endDate")} {...p} />}
        </Field>
      </div>
      <div className={showCosts ? "grid gap-3 sm:grid-cols-[2fr_1fr]" : undefined}>
        <Field label="Budget line" errors={f.errors("budgetLineId")}>
          {(p) => (
            <Select name="budgetLineId" defaultValue={f.value("budgetLineId")} {...p}>
              <option value="">Not linked</option>
              {options.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {showCosts ? (
          <Field label="Day rate" description="Cost per unit per day" errors={f.errors("dayRate")}>
            {(p) => (
              <Input
                name="dayRate"
                inputMode="decimal"
                className="tabular"
                defaultValue={f.value("dayRate")}
                {...p}
              />
            )}
          </Field>
        ) : null}
      </div>
      <Field label="Notes" errors={f.errors("notes")}>
        {(p) => <Textarea name="notes" rows={2} defaultValue={f.value("notes")} {...p} />}
      </Field>
      <div>
        <Button
          type="submit"
          variant={defaults.requirementId ? "secondary" : "primary"}
          disabled={f.pending}
        >
          {f.pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
