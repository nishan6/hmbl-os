"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

type Option = { id: string; label: string };

/** A crew member's identity, skills, contacts and, for those allowed, pay links. */
export function CrewForm({
  action,
  defaults,
  kinds,
  users,
  vendors,
  skills,
  sensitive,
  submitLabel,
  cancelHref,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults: Record<string, string>;
  kinds: Record<string, string>;
  users: Option[];
  vendors: Option[];
  skills: string[];
  /** Whether the emergency contact and the paying vendor can be seen and changed. */
  sensitive: boolean;
  submitLabel: string;
  cancelHref?: string;
}) {
  const f = useForm(action, defaults);
  const [kind, setKind] = useState(f.value("kind") || "FREELANCER");
  const text = (
    name: string,
    label: string,
    options: { required?: boolean; description?: string; type?: string } = {},
  ) => (
    <Field
      label={label}
      required={options.required}
      description={options.description}
      errors={f.errors(name)}
    >
      {(p) => <Input name={name} type={options.type} defaultValue={f.value(name)} {...p} />}
    </Field>
  );
  return (
    <form action={f.action} key={f.formKey} className="flex max-w-3xl flex-col gap-6" noValidate>
      <FormAlert {...f} title="The crew member wasn't saved" />
      <fieldset className="flex flex-col gap-3">
        <legend className="text-md text-text mb-2 font-semibold">Person</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {text("name", "Name", { required: true })}
          <Field label="Works as" required errors={f.errors("kind")}>
            {(p) => (
              <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} {...p}>
                {Object.entries(kinds).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {text("email", "Email", { type: "email" })}
          {text("phone", "Phone", { type: "tel" })}
          {text("baseCity", "Based in")}
          {kind === "EMPLOYEE" ? (
            <Field
              label="Sign-in"
              description="The HMBL OS user this person signs in as"
              errors={f.errors("userId")}
            >
              {(p) => (
                <Select name="userId" defaultValue={f.value("userId")} {...p}>
                  <option value="">None</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : sensitive ? (
            <Field
              label="Paid through vendor"
              description="Their bank details, PAN and TDS live on the vendor record"
              errors={f.errors("vendorId")}
            >
              {(p) => (
                <Select name="vendorId" defaultValue={f.value("vendorId")} {...p}>
                  <option value="">Not set up yet</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
        </div>
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-md text-text mb-2 font-semibold">Work</legend>
        <Field
          label="Roles and skills"
          description="Separate with commas, e.g. Lighting operator, Rigging, grandMA3"
          errors={f.errors("skills")}
        >
          {(p) => (
            <>
              <Input name="skills" list="crew-skills" defaultValue={f.value("skills")} {...p} />
              <datalist id="crew-skills">
                {skills.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Will also work in"
            description="Cities or regions, one per line"
            errors={f.errors("preferredLocations")}
          >
            {(p) => (
              <Textarea
                name="preferredLocations"
                rows={2}
                defaultValue={f.value("preferredLocations")}
                {...p}
              />
            )}
          </Field>
          {text("contractRef", "Contract reference", {
            description: "Agreement or NDA, filed under Documents",
          })}
        </div>
      </fieldset>
      {sensitive ? (
        <fieldset className="flex flex-col gap-3">
          <legend className="text-md text-text mb-2 font-semibold">Emergency contact</legend>
          <p className="text-secondary -mt-2 text-sm">
            Only people who manage crew pay and welfare can see this.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {text("emergencyContactName", "Contact name")}
            {text("emergencyContactPhone", "Contact phone", { type: "tel" })}
            {text("emergencyContactRelation", "Relationship")}
          </div>
        </fieldset>
      ) : null}
      <Field label="Notes" errors={f.errors("notes")}>
        {(p) => <Textarea name="notes" defaultValue={f.value("notes")} rows={2} {...p} />}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Saving…" : submitLabel}
        </Button>
        {cancelHref ? (
          <Link href={cancelHref} className={buttonClasses("secondary")}>
            Cancel
          </Link>
        ) : null}
      </div>
    </form>
  );
}
