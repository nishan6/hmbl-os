"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import { useUnsavedChangesWarning } from "@/components/ui/use-unsaved-changes";
import type { FormState } from "@/server/http/action-result";

type Option = { id: string; name: string };

export function OpportunityForm({
  action,
  defaults,
  entities,
  clients,
  users,
  businessUnits,
  submitLabel,
  cancelHref,
  editing,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults: Record<string, string>;
  entities: { id: string; code: string; legalName: string; baseCurrency: string }[];
  clients: (Option & { currency: string; contacts: Option[] })[];
  users: Option[];
  businessUnits: Option[];
  submitLabel: string;
  cancelHref: string;
  /** The entity can't change once the opportunity exists. */
  editing?: boolean;
}) {
  const f = useForm(action, defaults);
  const markDirty = useUnsavedChangesWarning(f.state);
  const [clientId, setClientId] = useState(f.value("clientId"));
  const contacts = clients.find((c) => c.id === clientId)?.contacts ?? [];

  return (
    <form
      action={f.action}
      onChange={markDirty}
      key={f.formKey}
      className="max-w-form flex flex-col gap-6"
      noValidate
    >
      <FormAlert {...f} title="The opportunity wasn't saved" />

      <fieldset className="flex flex-col gap-4">
        <legend className="text-md text-text mb-2 font-semibold">Enquiry</legend>
        <Field
          label="Title"
          required
          errors={f.errors("title")}
          description="What the client wants"
        >
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
          <Field label="Contact" errors={f.errors("contactId")}>
            {(p) => (
              <Select
                name="contactId"
                defaultValue={f.value("contactId")}
                key={clientId}
                disabled={!contacts.length}
                {...p}
              >
                <option value="">{contacts.length ? "None" : "No contacts at this client"}</option>
                {contacts.map((c) => (
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
            description={editing ? "Can't change after creation" : "Who would contract the work"}
            errors={f.errors("legalEntityId")}
          >
            {(p) => (
              <Select
                name="legalEntityId"
                defaultValue={f.value("legalEntityId")}
                disabled={editing}
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
          {editing ? (
            <input type="hidden" name="legalEntityId" value={f.value("legalEntityId")} />
          ) : null}
          <Field label="Business line" errors={f.errors("businessUnitId")}>
            {(p) => (
              <Select name="businessUnitId" defaultValue={f.value("businessUnitId")} {...p}>
                <option value="">Not set</option>
                {businessUnits.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Owner" errors={f.errors("ownerId")}>
            {(p) => (
              <Select name="ownerId" defaultValue={f.value("ownerId")} {...p}>
                <option value="">Nobody</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Source"
            description="e.g. Referral, website, repeat client"
            errors={f.errors("source")}
          >
            {(p) => <Input name="source" defaultValue={f.value("source")} list="sources" {...p} />}
          </Field>
          <datalist id="sources">
            <option value="Repeat client" />
            <option value="Referral" />
            <option value="Website" />
            <option value="Tender" />
            <option value="Agency" />
            <option value="Event or trade show" />
          </datalist>
        </div>
        <Field label="Description" errors={f.errors("description")}>
          {(p) => (
            <Textarea name="description" defaultValue={f.value("description")} rows={3} {...p} />
          )}
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-md text-text mb-2 font-semibold">Value and dates</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Expected value"
            description="Before tax; an estimate, not a quote"
            errors={f.errors("expectedValue")}
          >
            {(p) => (
              <Input
                name="expectedValue"
                inputMode="decimal"
                className="tabular"
                defaultValue={f.value("expectedValue")}
                {...p}
              />
            )}
          </Field>
          <Field label="Currency" required errors={f.errors("currency")}>
            {(p) => (
              <Input name="currency" maxLength={3} defaultValue={f.value("currency")} {...p} />
            )}
          </Field>
          <Field
            label="Win probability %"
            description="Blank uses the stage's default"
            errors={f.errors("probability")}
          >
            {(p) => (
              <Input
                name="probability"
                inputMode="decimal"
                defaultValue={f.value("probability")}
                {...p}
              />
            )}
          </Field>
          <Field label="Expected decision" errors={f.errors("expectedCloseDate")}>
            {(p) => (
              <Input
                name="expectedCloseDate"
                type="date"
                defaultValue={f.value("expectedCloseDate")}
                {...p}
              />
            )}
          </Field>
          <Field label="Event starts" errors={f.errors("eventStartDate")}>
            {(p) => (
              <Input
                name="eventStartDate"
                type="date"
                defaultValue={f.value("eventStartDate")}
                {...p}
              />
            )}
          </Field>
          <Field label="Event ends" errors={f.errors("eventEndDate")}>
            {(p) => (
              <Input
                name="eventEndDate"
                type="date"
                defaultValue={f.value("eventEndDate")}
                {...p}
              />
            )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Venue or city" errors={f.errors("venue")}>
            {(p) => <Input name="venue" defaultValue={f.value("venue")} {...p} />}
          </Field>
          <Field
            label="Competitors"
            description="Who else is pitching, if known"
            errors={f.errors("competitors")}
          >
            {(p) => <Input name="competitors" defaultValue={f.value("competitors")} {...p} />}
          </Field>
        </div>
      </fieldset>

      <div className="border-separator flex items-center gap-2 border-t pt-4">
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Saving…" : submitLabel}
        </Button>
        <Button asChild variant="quiet">
          <Link href={cancelHref}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
