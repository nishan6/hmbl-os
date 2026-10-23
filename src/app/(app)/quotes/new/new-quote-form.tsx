"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

type Option = { id: string; name: string };

export function NewQuoteForm({
  action,
  defaults,
  entities,
  clients,
  opportunities,
  cancelHref,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults: Record<string, string>;
  entities: { id: string; code: string; legalName: string }[];
  clients: Option[];
  opportunities: (Option & { clientId: string; legalEntityId: string })[];
  cancelHref: string;
}) {
  const f = useForm(action, defaults);
  const [clientId, setClientId] = useState(f.value("clientId"));
  const [entityId, setEntityId] = useState(f.value("legalEntityId"));
  const choices = opportunities.filter(
    (o) => o.clientId === clientId && (!entityId || o.legalEntityId === entityId),
  );

  return (
    <form action={f.action} key={f.formKey} className="max-w-form flex flex-col gap-4" noValidate>
      <FormAlert {...f} title="The quote wasn't created" />
      <Field label="Title" required errors={f.errors("title")} description="Shown on the quote">
        {(p) => <Input name="title" defaultValue={f.value("title")} {...p} />}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Client" required errors={f.errors("clientId")}>
          {(p) => (
            <Select
              name="clientId"
              defaultValue={f.value("clientId")}
              onChange={(e) => setClientId(e.target.value)}
              {...p}
            >
              <option value="">Choose…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="HMBL entity"
          required
          description="Who contracts the work and issues the quote"
          errors={f.errors("legalEntityId")}
        >
          {(p) => (
            <Select
              name="legalEntityId"
              defaultValue={f.value("legalEntityId")}
              onChange={(e) => setEntityId(e.target.value)}
              {...p}
            >
              <option value="">Choose…</option>
              {entities.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.code} · {e.legalName}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field
        label="Opportunity"
        description="Its currency, event dates and venue are copied to the quote"
        errors={f.errors("opportunityId")}
      >
        {(p) => (
          <Select
            name="opportunityId"
            defaultValue={f.value("opportunityId")}
            key={`${clientId}-${entityId}`}
            disabled={!choices.length}
            {...p}
          >
            <option value="">{choices.length ? "None" : "No open opportunities"}</option>
            {choices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Creating…" : "Create and add lines"}
        </Button>
        <Button asChild variant="quiet">
          <Link href={cancelHref}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
