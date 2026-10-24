"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

/** Names the claim and the company the money was spent for. */
export function StartClaimForm({
  action,
  entities,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  entities: { id: string; code: string; legalName: string; baseCurrency: string }[];
}) {
  const f = useForm(action, { legalEntityId: entities.length === 1 ? entities[0]!.id : "" });
  return (
    <form action={f.action} key={f.formKey} className="max-w-form flex flex-col gap-4" noValidate>
      <FormAlert {...f} title="The claim wasn't started" />
      <Field
        label="What it was for"
        description="For example, Site recce, Guwahati, 10–12 September"
        required
        errors={f.errors("title")}
      >
        {(p) => <Input name="title" defaultValue={f.value("title")} {...p} />}
      </Field>
      <Field label="Company" required errors={f.errors("legalEntityId")}>
        {(p) => (
          <Select name="legalEntityId" defaultValue={f.value("legalEntityId")} {...p}>
            <option value="">Choose…</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.code} · {e.legalName} ({e.baseCurrency})
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Starting…" : "Start claim"}
        </Button>
        <Button asChild variant="quiet">
          <Link href="/expenses">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
