"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import { useUnsavedChangesWarning } from "@/components/ui/use-unsaved-changes";
import type { FormState } from "@/server/http/action-result";

/** Money advanced to a person, paid from a bank or cash account. */
export function AdvanceForm({
  action,
  people,
  projects,
  accounts,
  methods,
  currency,
  defaults,
  cancelHref,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  people: { id: string; name: string }[];
  projects: { id: string; number: string; name: string }[];
  accounts: { id: string; code: string; name: string }[];
  methods: Record<string, string>;
  currency: string;
  defaults: Record<string, string>;
  cancelHref: string;
}) {
  const f = useForm(action, defaults);
  const markDirty = useUnsavedChangesWarning(f.state);
  return (
    <form
      action={f.action}
      onChange={markDirty}
      key={f.formKey}
      className="max-w-form flex flex-col gap-4"
      noValidate
    >
      <FormAlert {...f} title="The advance wasn't recorded" />
      <Field label="Paid to" required errors={f.errors("personId")}>
        {(p) => (
          <Select name="personId" defaultValue={f.value("personId")} {...p}>
            <option value="">Choose…</option>
            {people.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Purpose" required errors={f.errors("purpose")}>
        {(p) => <Input name="purpose" defaultValue={f.value("purpose")} {...p} />}
      </Field>
      <Field label="Project" errors={f.errors("projectId")}>
        {(p) => (
          <Select name="projectId" defaultValue={f.value("projectId")} {...p}>
            <option value="">No project</option>
            {projects.map((x) => (
              <option key={x.id} value={x.id}>
                {x.number} · {x.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Date" required errors={f.errors("date")}>
          {(p) => <Input type="date" name="date" defaultValue={f.value("date")} {...p} />}
        </Field>
        <Field label={`Amount (${currency})`} required errors={f.errors("amount")}>
          {(p) => (
            <Input
              name="amount"
              inputMode="decimal"
              className="tabular text-right"
              defaultValue={f.value("amount")}
              {...p}
            />
          )}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Paid from" required errors={f.errors("paidFromId")}>
          {(p) => (
            <Select name="paidFromId" defaultValue={f.value("paidFromId")} {...p}>
              <option value="">Choose…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Method" required errors={f.errors("method")}>
          {(p) => (
            <Select name="method" defaultValue={f.value("method")} {...p}>
              {Object.entries(methods).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Reference" description="UTR or cheque number" errors={f.errors("reference")}>
        {(p) => <Input name="reference" defaultValue={f.value("reference")} {...p} />}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Recording…" : "Record advance"}
        </Button>
        <Button asChild variant="quiet">
          <Link href={cancelHref}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
