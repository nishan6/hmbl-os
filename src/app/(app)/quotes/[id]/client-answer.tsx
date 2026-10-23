"use client";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** Records the client's answer to an issued quote: accepted (with evidence) or declined. */
export function ClientAnswer({
  accept,
  decline,
  methods,
  poRequired,
  today,
}: {
  accept: Action;
  decline: Action;
  methods: Record<string, string>;
  poRequired: boolean;
  today: string;
}) {
  const a = useForm(accept, { acceptedOn: today });
  const d = useForm(decline);
  return (
    <div className="flex flex-col gap-4">
      <form action={a.action} key={a.formKey} className="flex flex-col gap-3" noValidate>
        <h3 className="text-text text-sm font-semibold">The client accepted</h3>
        <p className="text-secondary -mt-2 text-sm">
          Record the evidence. This creates the project, marks the opportunity won and the quote can
          no longer be revised.
        </p>
        <FormAlert {...a} title="The acceptance wasn't recorded" />
        <Field label="Accepted on" required errors={a.errors("acceptedOn")}>
          {(p) => (
            <Input
              type="date"
              name="acceptedOn"
              max={today}
              defaultValue={a.value("acceptedOn")}
              {...p}
            />
          )}
        </Field>
        <Field label="Accepted by" required errors={a.errors("acceptedByName")}>
          {(p) => (
            <Input
              name="acceptedByName"
              autoComplete="off"
              defaultValue={a.value("acceptedByName")}
              {...p}
            />
          )}
        </Field>
        <Field label="How" required errors={a.errors("acceptanceMethod")}>
          {(p) => (
            <Select name="acceptanceMethod" defaultValue={a.value("acceptanceMethod")} {...p}>
              <option value="">Choose…</option>
              {Object.entries(methods).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Client PO number"
          required={poRequired}
          description={
            poRequired ? "This quote needs one" : "Needed when accepted by purchase order"
          }
          errors={a.errors("clientPoNumber")}
        >
          {(p) => <Input name="clientPoNumber" defaultValue={a.value("clientPoNumber")} {...p} />}
        </Field>
        <Field label="Notes" errors={a.errors("acceptanceNotes")}>
          {(p) => (
            <Textarea
              name="acceptanceNotes"
              rows={2}
              defaultValue={a.value("acceptanceNotes")}
              {...p}
            />
          )}
        </Field>
        <div>
          <Button type="submit" variant="primary" disabled={a.pending}>
            {a.pending ? "Recording…" : "Record acceptance and create project"}
          </Button>
        </div>
      </form>
      <details className="text-sm">
        <summary className="text-secondary hover:text-text cursor-pointer">
          The client declined
        </summary>
        <form action={d.action} key={d.formKey} className="mt-3 flex flex-col gap-3" noValidate>
          <FormAlert {...d} title="That didn't work" />
          <Field label="Reason" required errors={d.errors("reason")}>
            {(p) => <Textarea name="reason" rows={2} defaultValue={d.value("reason")} {...p} />}
          </Field>
          <div>
            <Button type="submit" variant="secondary" disabled={d.pending}>
              Mark as declined
            </Button>
          </div>
        </form>
      </details>
    </div>
  );
}
