"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

type ProjectOption = {
  id: string;
  number: string;
  name: string;
  clientId: string | null;
  milestones: { id: string; label: string }[];
};

/** Picks who the invoice is for, and optionally the project milestone it bills. */
export function StartInvoiceForm({
  action,
  clients,
  projects,
  defaults,
  cancelHref,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  clients: { id: string; name: string }[];
  projects: ProjectOption[];
  defaults: Record<string, string>;
  cancelHref: string;
}) {
  const f = useForm(action, defaults);
  const [clientId, setClientId] = useState(f.value("clientId"));
  const [projectId, setProjectId] = useState(f.value("projectId"));
  const forClient = projects.filter((p) => p.clientId === clientId);
  const project = forClient.find((p) => p.id === projectId);
  return (
    <form action={f.action} key={f.formKey} className="max-w-form flex flex-col gap-4" noValidate>
      <FormAlert {...f} title="The invoice wasn't started" />
      <Field label="Client" required errors={f.errors("clientId")}>
        {(p) => (
          <Select
            name="clientId"
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setProjectId("");
            }}
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
        label="Project"
        description="Optional. Income from the invoice is tracked against the project."
        errors={f.errors("projectId")}
      >
        {(p) => (
          <Select
            name="projectId"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={!forClient.length}
            {...p}
          >
            <option value="">{forClient.length ? "None" : "No projects for this client"}</option>
            {forClient.map((pr) => (
              <option key={pr.id} value={pr.id}>
                {pr.number} · {pr.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {project?.milestones.length ? (
        <Field
          label="Billing milestone"
          description="Starts the invoice with the milestone's share of the contract value."
          errors={f.errors("milestoneId")}
        >
          {(p) => (
            <Select name="milestoneId" defaultValue={f.value("milestoneId")} {...p}>
              <option value="">None: I&apos;ll add the lines</option>
              {project.milestones.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Starting…" : "Start invoice"}
        </Button>
        <Button asChild variant="quiet">
          <Link href={cancelHref}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
