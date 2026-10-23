"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** A show date, a phase or a milestone. */
export function ScheduleItemForm({
  action,
  kinds,
  defaults = { kind: "MILESTONE" },
  submitLabel = "Add to schedule",
}: {
  action: Action;
  kinds: Record<string, string>;
  defaults?: Record<string, string>;
  submitLabel?: string;
}) {
  const f = useForm(action, defaults);
  const [kind, setKind] = useState(f.value("kind"));
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The schedule wasn't saved" />
      {defaults.itemId ? <input type="hidden" name="itemId" value={defaults.itemId} /> : null}
      <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <Field label="What" required errors={f.errors("kind")}>
          {(p) => (
            <Select
              name="kind"
              defaultValue={f.value("kind")}
              onChange={(e) => setKind(e.target.value)}
              {...p}
            >
              {Object.entries(kinds).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Title"
          required
          description={kind === "PHASE" ? "e.g. Build, Load-in, Rehearsal" : undefined}
          errors={f.errors("title")}
        >
          {(p) => <Input name="title" defaultValue={f.value("title")} {...p} />}
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field
          label={kind === "MILESTONE" ? "Due" : "From"}
          required
          errors={f.errors("startDate")}
        >
          {(p) => <Input name="startDate" type="date" defaultValue={f.value("startDate")} {...p} />}
        </Field>
        {kind === "MILESTONE" ? null : (
          <Field label="To" description="Blank for one day" errors={f.errors("endDate")}>
            {(p) => <Input name="endDate" type="date" defaultValue={f.value("endDate")} {...p} />}
          </Field>
        )}
        <Field label="Where" errors={f.errors("location")}>
          {(p) => <Input name="location" defaultValue={f.value("location")} {...p} />}
        </Field>
      </div>
      <Field label="Notes" errors={f.errors("notes")}>
        {(p) => <Textarea name="notes" rows={2} defaultValue={f.value("notes")} {...p} />}
      </Field>
      <div>
        <Button
          type="submit"
          variant={defaults.itemId ? "secondary" : "primary"}
          disabled={f.pending}
        >
          {f.pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** A billing milestone's due date set by hand, with the reason. */
export function BillingDueDateForm({
  action,
  defaults,
  label,
}: {
  action: Action;
  defaults: Record<string, string>;
  label: string;
}) {
  const f = useForm(action, defaults);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The due date wasn't saved" />
      <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
        <Field
          label="Due date"
          description="Blank follows the payment terms"
          errors={f.errors("dueDate")}
        >
          {(p) => <Input name="dueDate" type="date" defaultValue={f.value("dueDate")} {...p} />}
        </Field>
        <Field label="Reason" errors={f.errors("note")}>
          {(p) => <Input name="note" defaultValue={f.value("note")} {...p} />}
        </Field>
      </div>
      <div>
        <Button type="submit" variant="secondary" disabled={f.pending}>
          {f.pending ? "Saving…" : "Save due date"}
          <span className="sr-only"> for {label}</span>
        </Button>
      </div>
    </form>
  );
}
