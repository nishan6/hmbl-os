"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FieldSource, ImportField } from "@/lib/imports";
import type { FormState } from "@/server/http/action-result";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

const sourceValue = (s: FieldSource | undefined) =>
  s === undefined ? "" : typeof s === "number" ? String(s) : "fixed";

function MappingRow({
  field,
  headers,
  sample,
  source,
  errors,
}: {
  field: ImportField;
  headers: string[];
  sample: string[];
  source: FieldSource | undefined;
  errors?: string[];
}) {
  const [choice, setChoice] = useState(sourceValue(source));
  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_minmax(0,1fr)] sm:items-end">
      <Field
        label={field.label}
        description={field.hint}
        required={field.required}
        errors={errors}
        className="sm:col-span-2"
      >
        {(p) => (
          <Select
            name={`source.${field.key}`}
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            {...p}
          >
            <option value="">{field.required ? "Choose…" : "Not imported"}</option>
            {headers.map((h, i) => (
              <option key={i} value={i}>
                Column “{h}”{sample[i] ? ` (e.g. ${sample[i]!.slice(0, 40)})` : ""}
              </option>
            ))}
            <option value="fixed">The same value for every row</option>
          </Select>
        )}
      </Field>
      {choice === "fixed" ? (
        <Field label={`${field.label} for every row`}>
          {(p) => (
            <Input
              name={`fixed.${field.key}`}
              defaultValue={typeof source === "object" ? source.value : ""}
              {...p}
            />
          )}
        </Field>
      ) : null}
    </div>
  );
}

/** Which column feeds each field, or one value for the whole file. */
export function MappingForm({
  action,
  fields,
  headers,
  sample,
  mapping,
}: {
  action: Action;
  fields: ImportField[];
  headers: string[];
  sample: string[];
  mapping: Record<string, FieldSource>;
}) {
  const f = useForm(action);
  return (
    <form action={f.action} className="flex flex-col gap-4" noValidate>
      <FormAlert {...f} title="The mapping wasn't saved" />
      {fields.map((field) => (
        <MappingRow
          key={field.key}
          field={field}
          headers={headers}
          sample={sample}
          source={mapping[field.key]}
          errors={f.errors(field.key)}
        />
      ))}
      <div>
        <Button type="submit" variant="secondary" disabled={f.pending}>
          {f.pending ? "Checking every row…" : "Save mapping and check again"}
        </Button>
      </div>
    </form>
  );
}

/** Corrects one row's values without changing the file. Blank clears a value. */
export function CorrectionForm({
  action,
  fields,
  values,
  errors,
}: {
  action: Action;
  fields: ImportField[];
  values: Record<string, string>;
  errors: Record<string, string[]>;
}) {
  const f = useForm(action);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3 py-2" noValidate>
      <FormAlert {...f} title="The correction wasn't saved" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((field) => (
          <Field
            key={field.key}
            label={field.label}
            description={field.hint}
            required={field.required}
            errors={f.errors(field.key) ?? errors[field.key]}
          >
            {(p) => (
              <Input
                name={field.key}
                defaultValue={f.value(field.key) || values[field.key] || ""}
                {...p}
              />
            )}
          </Field>
        ))}
      </div>
      <div>
        <Button type="submit" size="sm" variant="secondary" disabled={f.pending}>
          {f.pending ? "Checking…" : "Save correction"}
        </Button>
      </div>
    </form>
  );
}

/** The dry run: checks everything again and says what committing would do. */
export function DryRunForm({ action }: { action: Action }) {
  const f = useForm(action);
  return (
    <form action={f.action} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="Not ready to commit" />
      <div>
        <Button type="submit" variant="secondary" disabled={f.pending}>
          {f.pending ? "Checking…" : "Dry run"}
        </Button>
      </div>
    </form>
  );
}
