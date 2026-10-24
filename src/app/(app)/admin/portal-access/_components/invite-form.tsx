"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Alert } from "@/components/ui/page";
import type { FormState } from "@/server/http/action-result";
import type { InviteState } from "../actions";

type Option = { value: string; label: string };

/** Invite form. On success shows the link once, to copy and send by hand. */
export function InviteForm({
  action,
  permissions,
  defaults,
  contacts,
}: {
  action: (state: InviteState, formData: FormData) => Promise<InviteState>;
  permissions: Option[];
  defaults: string[];
  contacts?: { id: string; name: string; email: string | null }[];
}) {
  const [state, run, pending] = useActionState<InviteState, FormData>(action, { status: "idle" });
  const alertRef = useRef<HTMLDivElement>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const copied = !!state.link && copiedLink === state.link;
  useEffect(() => {
    if (state.status === "error") alertRef.current?.focus();
  }, [state]);
  const values = state.status === "error" ? (state.values ?? {}) : {};
  const errors = (name: string) =>
    state.status === "error" ? state.fieldErrors?.[name] : undefined;

  return (
    <div className="flex flex-col gap-4">
      {state.status === "success" && state.link ? (
        <Alert tone="success" title={`Invitation ready for ${state.email}`}>
          <p className="mb-2">
            Send this link to them yourself. It is shown only now, and works once, for 14 days. They
            will also need to type their email address.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              readOnly
              value={state.link}
              aria-label="Invitation link"
              className="min-w-0 flex-1 font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(state.link!);
                setCopiedLink(state.link!);
              }}
            >
              <Copy aria-hidden />
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
        </Alert>
      ) : null}
      <form
        action={run}
        key={`${state.status}-${state.savedAt ?? JSON.stringify(values)}`}
        className="flex flex-col gap-3"
        noValidate
      >
        <FormAlert state={state} alertRef={alertRef} title="The invitation wasn't created" />
        {contacts ? (
          <Field label="Contact" required errors={errors("contactId")}>
            {(p) => (
              <Select name="contactId" defaultValue={values.contactId ?? ""} {...p}>
                <option value="">Choose a contact…</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.email ? ` (${c.email})` : ""}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" required errors={errors("name")}>
            {(p) => (
              <Input name="name" defaultValue={values.name ?? ""} autoComplete="off" {...p} />
            )}
          </Field>
          <Field label="Email" required errors={errors("email")}>
            {(p) => (
              <Input
                name="email"
                type="email"
                defaultValue={values.email ?? ""}
                autoComplete="off"
                {...p}
              />
            )}
          </Field>
        </div>
        <fieldset>
          <legend className="text-text text-sm font-medium">They may</legend>
          {errors("permissions") ? (
            <p className="text-danger text-xs">{errors("permissions")!.join(" ")}</p>
          ) : null}
          <div className="mt-1 flex flex-col gap-1">
            {permissions.map((p) => (
              <label key={p.value} className="text-secondary flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="permissions"
                  value={p.value}
                  defaultChecked={defaults.includes(p.value)}
                  className="mt-1"
                />
                {p.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Creating…" : "Create invitation"}
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Ticks for what an existing account may do. */
export function PermissionsForm({
  action,
  permissions,
  current,
  label,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  permissions: Option[];
  current: string[];
  label: string;
}) {
  const [state, run, pending] = useActionState<FormState, FormData>(action, { status: "idle" });
  const alertRef = useRef<HTMLDivElement>(null);
  return (
    <form action={run} className="flex flex-col gap-2" noValidate>
      <FormAlert state={state} alertRef={alertRef} title="Not saved" />
      <fieldset>
        <legend className="sr-only">{label}</legend>
        {permissions.map((p) => (
          <label key={p.value} className="text-secondary flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="permissions"
              value={p.value}
              defaultChecked={current.includes(p.value)}
              className="mt-1"
            />
            {p.label}
          </label>
        ))}
      </fieldset>
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
