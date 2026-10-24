"use client";

import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** Records the last number already issued, to carry a series on. */
export function CounterForm({
  action,
  defaults,
  clientCount,
}: {
  action: Action;
  defaults: Record<string, string>;
  /** The format has a per-client count, so a client code can be given. */
  clientCount: boolean;
}) {
  const f = useForm(action, defaults);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The count wasn't set" />
      <div className="flex flex-wrap items-end gap-3">
        <Field
          label="For numbers dated"
          required
          description="Any day in the period"
          errors={f.errors("date")}
        >
          {(p) => <Input type="date" name="date" defaultValue={f.value("date")} {...p} />}
        </Field>
        {clientCount ? (
          <Field
            label="Client code"
            description="Blank for the overall count"
            errors={f.errors("clientCode")}
          >
            {(p) => (
              <Input
                name="clientCode"
                maxLength={6}
                className="w-28 font-mono uppercase"
                defaultValue={f.value("clientCode")}
                {...p}
              />
            )}
          </Field>
        ) : null}
        <Field label="Last number issued" required errors={f.errors("lastValue")}>
          {(p) => (
            <Input
              name="lastValue"
              inputMode="numeric"
              className="tabular w-32 text-right"
              defaultValue={f.value("lastValue")}
              {...p}
            />
          )}
        </Field>
        <Button type="submit" disabled={f.pending}>
          {f.pending ? "Saving…" : "Set count"}
        </Button>
      </div>
    </form>
  );
}

/** Archives this format and starts its replacement in one step. */
export function ReplaceForm({
  action,
  defaults,
  resets,
}: {
  action: Action;
  defaults: Record<string, string>;
  resets: Record<string, string>;
}) {
  const f = useForm(action, defaults);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The format wasn't replaced" />
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem_8rem]">
        <Field label="Pattern" required errors={f.errors("pattern")}>
          {(p) => (
            <Input name="pattern" className="font-mono" defaultValue={f.value("pattern")} {...p} />
          )}
        </Field>
        <Field label="Count restarts" required errors={f.errors("resetPolicy")}>
          {(p) => (
            <Select name="resetPolicy" defaultValue={f.value("resetPolicy")} {...p}>
              {Object.entries(resets).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="First number" required errors={f.errors("startAt")}>
          {(p) => (
            <Input
              name="startAt"
              inputMode="numeric"
              className="tabular text-right"
              defaultValue={f.value("startAt")}
              {...p}
            />
          )}
        </Field>
      </div>
      <input type="hidden" name="fiscalYearStartMonth" value={f.value("fiscalYearStartMonth")} />
      <div>
        <Button type="submit" disabled={f.pending}>
          {f.pending ? "Replacing…" : "Replace format"}
        </Button>
      </div>
    </form>
  );
}
