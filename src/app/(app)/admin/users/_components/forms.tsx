"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Alert } from "@/components/ui/page";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";
import type { LinkFormState } from "../actions";

type Options = {
  roles: { key: string; name: string }[];
  entities: { id: string; code: string; legalName: string }[];
};

/** The link a form just made, shown once to copy and send by hand. */
function NewLink({ state, title, note }: { state: LinkFormState; title: string; note: string }) {
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  if (state.status !== "success" || !state.link) return null;
  const copied = copiedLink === state.link;
  return (
    <Alert tone="success" title={`${title} ${state.email}`}>
      <p className="mb-2">{note}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          readOnly
          value={state.link}
          aria-label="Link"
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
  );
}

function useLinkForm(action: (state: LinkFormState, formData: FormData) => Promise<LinkFormState>) {
  const [state, run, pending] = useActionState<LinkFormState, FormData>(action, {
    status: "idle",
  });
  const alertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.status === "error") alertRef.current?.focus();
  }, [state]);
  const values = state.status === "error" ? (state.values ?? {}) : {};
  return {
    state,
    run,
    pending,
    alertRef,
    values,
    key: `${state.status}-${state.savedAt ?? JSON.stringify(values)}`,
    errors: (name: string) => (state.status === "error" ? state.fieldErrors?.[name] : undefined),
  };
}

function RoleFields({
  options,
  values,
  errors,
}: {
  options: Options;
  values: Record<string, string>;
  errors: (name: string) => string[] | undefined;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Role" required errors={errors("roleKey")}>
        {(p) => (
          <Select name="roleKey" defaultValue={values.roleKey ?? ""} {...p}>
            <option value="">Choose a role…</option>
            {options.roles.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label="For"
        description="A role can be limited to one legal entity."
        errors={errors("legalEntityId")}
      >
        {(p) => (
          <Select name="legalEntityId" defaultValue={values.legalEntityId ?? ""} {...p}>
            <option value="">Every legal entity</option>
            {options.entities.map((e) => (
              <option key={e.id} value={e.id}>
                {e.code} · {e.legalName}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}

/** Invites a staff member with one role. More roles can be granted once they have joined. */
export function InviteStaffForm({
  action,
  options,
  days,
}: {
  action: (state: LinkFormState, formData: FormData) => Promise<LinkFormState>;
  options: Options;
  days: number;
}) {
  const f = useLinkForm(action);
  return (
    <div className="flex flex-col gap-4">
      <NewLink
        state={f.state}
        title="Invitation ready for"
        note={`Send this link to them yourself. It is shown only now, and works once, for ${days} days. They will also need to type their email address.`}
      />
      <form action={f.run} key={f.key} className="flex flex-col gap-3" noValidate>
        <FormAlert state={f.state} alertRef={f.alertRef} title="The invitation wasn't created" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" required errors={f.errors("name")}>
            {(p) => (
              <Input name="name" defaultValue={f.values.name ?? ""} autoComplete="off" {...p} />
            )}
          </Field>
          <Field label="Email" required errors={f.errors("email")}>
            {(p) => (
              <Input
                name="email"
                type="email"
                defaultValue={f.values.email ?? ""}
                autoComplete="off"
                {...p}
              />
            )}
          </Field>
        </div>
        <RoleFields options={options} values={f.values} errors={f.errors} />
        <div>
          <Button type="submit" variant="primary" disabled={f.pending}>
            {f.pending ? "Creating…" : "Create invitation"}
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Makes a link for someone to set a new password, optionally resetting two-factor. */
export function PasswordLinkForm({
  action,
  hours,
}: {
  action: (state: LinkFormState, formData: FormData) => Promise<LinkFormState>;
  hours: number;
}) {
  const f = useLinkForm(action);
  return (
    <div className="flex flex-col gap-4">
      <NewLink
        state={f.state}
        title="Password link ready for"
        note={`Send this link to them yourself. It is shown only now, and works once, for ${hours} hours. Their sessions end when they use it.`}
      />
      <form action={f.run} key={f.key} className="flex flex-col gap-3" noValidate>
        <FormAlert state={f.state} alertRef={f.alertRef} title="No link was made" />
        <label className="text-secondary flex items-start gap-2 text-sm">
          <input type="checkbox" name="resetTwoFactor" className="mt-1" />
          <span>
            Also remove their authenticator app, for a lost or replaced phone. They set it up again
            when they next sign in if their role needs it.
          </span>
        </label>
        <div>
          <Button type="submit" variant="secondary" disabled={f.pending}>
            {f.pending ? "Making…" : "Make a password link"}
          </Button>
        </div>
      </form>
    </div>
  );
}

/** Grants one more role. */
export function GrantRoleForm({
  action,
  options,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  options: Options;
}) {
  const f = useForm(action);
  const values = f.state.status === "error" ? (f.state.values ?? {}) : {};
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The role wasn't granted" />
      <RoleFields options={options} values={values} errors={f.errors} />
      <div>
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Granting…" : "Grant role"}
        </Button>
      </div>
    </form>
  );
}
