"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** The cut-over date and the totals from the old system's own reports. */
export function SetupForm({
  action,
  defaults,
  currency,
  disabled,
}: {
  action: Action;
  defaults: Record<string, string>;
  currency: string;
  disabled: boolean;
}) {
  const f = useForm(action, defaults);
  const text = (name: string, label: string, description?: string, required?: boolean) => (
    <Field label={label} description={description} required={required} errors={f.errors(name)}>
      {(p) => <Input name={name} defaultValue={f.value(name)} disabled={disabled} {...p} />}
    </Field>
  );
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-4" noValidate>
      <FormAlert {...f} title="Not saved" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Cut-over date"
          description="Balances as at the end of this day. HMBL OS keeps the books from the next."
          required
          errors={f.errors("cutOverDate")}
        >
          {(p) => (
            <Input
              type="date"
              name="cutOverDate"
              defaultValue={f.value("cutOverDate")}
              disabled={disabled}
              {...p}
            />
          )}
        </Field>
        {text("sourceSystem", "Old system", "e.g. Tally Prime", true)}
      </div>
      <p className="text-secondary text-sm">
        From the old system&apos;s own reports on the cut-over date, in {currency}. Nothing posts
        until these agree with what you import.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        {text("sourceDebit", "Trial balance total debits")}
        {text("sourceReceivables", "Trade receivables (sundry debtors)")}
        {text("sourcePayables", "Trade payables (sundry creditors)")}
        {text("sourceInvoiceCount", "Open invoices (count)")}
        {text("sourceBillCount", "Open bills (count)")}
      </div>
      <Field label="Notes" errors={f.errors("notes")}>
        {(p) => (
          <Textarea name="notes" defaultValue={f.value("notes")} disabled={disabled} {...p} />
        )}
      </Field>
      {disabled ? null : (
        <div>
          <Button type="submit" variant="secondary" disabled={f.pending}>
            {f.pending ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </form>
  );
}

/** One of the three files. A new file replaces the earlier one; a file with any problem saves nothing. */
export function FileForm({
  action,
  section,
  label,
  columns,
  templateName,
}: {
  action: Action;
  section: string;
  label: string;
  columns: string[];
  templateName: string;
}) {
  const f = useForm(action);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const template = `data:text/csv;charset=utf-8,${encodeURIComponent(columns.join(",") + "\r\n")}`;
  const problems = f.errors("text");
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      {f.state.status === "success" ? <FormAlert {...f} title="" /> : null}
      {f.state.status === "error" && !problems ? (
        <FormAlert {...f} title="Nothing was saved" />
      ) : null}
      <input type="hidden" name="section" value={section} />
      <Field
        label={label}
        description={`Columns: ${columns.join(", ")}.`}
        errors={
          problems
            ? [`Nothing was saved. ${problems.length} problem${problems.length === 1 ? "" : "s"}:`]
            : undefined
        }
      >
        {(p) => (
          <Input
            type="file"
            accept=".csv,text/csv"
            className="h-auto py-1.5"
            onChange={async (e) => {
              const chosen = e.target.files?.[0];
              setFile(chosen ? { name: chosen.name, text: await chosen.text() } : null);
            }}
            {...p}
          />
        )}
      </Field>
      {problems ? (
        <ul className="text-danger list-inside list-disc text-sm">
          {problems.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}
      {file ? <input type="hidden" name="text" value={file.text} /> : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" size="sm" disabled={f.pending || !file}>
          {f.pending ? "Checking…" : "Check and save"}
        </Button>
        <a href={template} download={templateName} className="text-accent text-sm hover:underline">
          Download the template
        </a>
      </div>
    </form>
  );
}
