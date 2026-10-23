"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import { useUnsavedChangesWarning } from "@/components/ui/use-unsaved-changes";
import { REVENUE_MODELS } from "@/server/projects/schemas";
import type { FormState } from "@/server/http/action-result";

type Option = { id: string; name: string };

/**
 * Project details. Creating a project also asks for the entity, client and
 * currency, which can't change afterwards.
 */
export function ProjectForm({
  action,
  defaults,
  entities,
  clients,
  users,
  businessUnits,
  types,
  submitLabel,
  cancelHref,
  creating,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults: Record<string, string>;
  entities: { id: string; code: string; legalName: string; baseCurrency: string }[];
  clients: (Option & { currency: string })[];
  users: Option[];
  businessUnits: Option[];
  types: (Option & { defaultRevenueModel: string })[];
  submitLabel: string;
  cancelHref: string;
  creating?: boolean;
}) {
  const f = useForm(action, defaults);
  const markDirty = useUnsavedChangesWarning(f.state);
  const [revenueModel, setRevenueModel] = useState(f.value("revenueModel"));
  const [currency, setCurrency] = useState(f.value("currency"));

  return (
    <form
      action={f.action}
      onChange={markDirty}
      key={f.formKey}
      className="max-w-form flex flex-col gap-6"
      noValidate
    >
      <FormAlert {...f} title="The project wasn't saved" />

      <fieldset className="flex flex-col gap-4">
        <legend className="text-md text-text mb-2 font-semibold">Project</legend>
        <Field label="Name" required errors={f.errors("name")}>
          {(p) => <Input name="name" defaultValue={f.value("name")} {...p} />}
        </Field>
        {creating ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="HMBL entity" required errors={f.errors("legalEntityId")}>
              {(p) => (
                <Select
                  name="legalEntityId"
                  defaultValue={f.value("legalEntityId")}
                  onChange={(e) => {
                    const entity = entities.find((x) => x.id === e.target.value);
                    if (entity && !currency) setCurrency(entity.baseCurrency);
                  }}
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
            <Field
              label="Client"
              description="Leave empty for internal work"
              errors={f.errors("clientId")}
            >
              {(p) => (
                <Select
                  name="clientId"
                  defaultValue={f.value("clientId")}
                  onChange={(e) => {
                    const client = clients.find((c) => c.id === e.target.value);
                    if (client) setCurrency(client.currency);
                  }}
                  {...p}
                >
                  <option value="">None (internal)</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Currency" required errors={f.errors("currency")}>
              {(p) => (
                <Input
                  name="currency"
                  maxLength={3}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  {...p}
                />
              )}
            </Field>
          </div>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Project type" errors={f.errors("projectTypeId")}>
            {(p) => (
              <Select
                name="projectTypeId"
                defaultValue={f.value("projectTypeId")}
                onChange={(e) => {
                  const type = types.find((t) => t.id === e.target.value);
                  if (type && creating) setRevenueModel(type.defaultRevenueModel);
                }}
                {...p}
              >
                <option value="">Not set</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Revenue model" required errors={f.errors("revenueModel")}>
            {(p) => (
              <Select
                name="revenueModel"
                value={revenueModel}
                onChange={(e) => setRevenueModel(e.target.value)}
                {...p}
              >
                {Object.entries(REVENUE_MODELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
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
          <Field label="Client PO" errors={f.errors("clientPoNumber")}>
            {(p) => <Input name="clientPoNumber" defaultValue={f.value("clientPoNumber")} {...p} />}
          </Field>
          <Field label="Project manager" errors={f.errors("projectManagerId")}>
            {(p) => (
              <Select name="projectManagerId" defaultValue={f.value("projectManagerId")} {...p}>
                <option value="">Nobody yet</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Producer"
            description="Or the operational owner"
            errors={f.errors("producerId")}
          >
            {(p) => (
              <Select name="producerId" defaultValue={f.value("producerId")} {...p}>
                <option value="">Nobody yet</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-md text-text mb-2 font-semibold">Dates and places</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Starts" errors={f.errors("eventStartDate")}>
            {(p) => (
              <Input
                name="eventStartDate"
                type="date"
                defaultValue={f.value("eventStartDate")}
                {...p}
              />
            )}
          </Field>
          <Field label="Ends" errors={f.errors("eventEndDate")}>
            {(p) => (
              <Input
                name="eventEndDate"
                type="date"
                defaultValue={f.value("eventEndDate")}
                {...p}
              />
            )}
          </Field>
          <Field label="Venue or city" errors={f.errors("venue")}>
            {(p) => <Input name="venue" defaultValue={f.value("venue")} {...p} />}
          </Field>
        </div>
        <Field
          label="Other locations"
          description="One per line, for tours or work at several sites"
          errors={f.errors("locations")}
        >
          {(p) => <Textarea name="locations" rows={2} defaultValue={f.value("locations")} {...p} />}
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-md text-text mb-2 font-semibold">Scope</legend>
        <Field label="Description" errors={f.errors("description")}>
          {(p) => (
            <Textarea name="description" rows={2} defaultValue={f.value("description")} {...p} />
          )}
        </Field>
        <Field label="Scope" errors={f.errors("scope")}>
          {(p) => <Textarea name="scope" rows={4} defaultValue={f.value("scope")} {...p} />}
        </Field>
        <Field label="Deliverables" errors={f.errors("deliverables")}>
          {(p) => (
            <Textarea name="deliverables" rows={3} defaultValue={f.value("deliverables")} {...p} />
          )}
        </Field>
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
