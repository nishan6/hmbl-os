"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import type { FormState } from "@/server/http/action-result";
import { createLegalEntityAction } from "./actions";

const DEFAULTS: Record<string, string> = {
  countryCode: "IN",
  baseCurrency: "INR",
  timezone: "Asia/Kolkata",
};

export function EntityForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createLegalEntityAction, {
    status: "idle",
  });
  const [dirty, setDirty] = useState(false);
  const alertRef = useRef<HTMLDivElement>(null);
  const value = (name: string) => state.values?.[name] ?? DEFAULTS[name] ?? "";
  const errors = (name: string) => state.fieldErrors?.[name];

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (state.status === "error") alertRef.current?.focus();
  }, [state]);

  return (
    <form
      action={action}
      onChange={() => setDirty(true)}
      // key resets uncontrolled inputs to the returned values after each attempt
      key={JSON.stringify(state.values ?? {})}
      className="max-w-form flex flex-col gap-6"
      noValidate
    >
      {state.status === "error" ? (
        <div ref={alertRef} tabIndex={-1} className="outline-none">
          <Alert tone="danger" title="The entity wasn't created">
            {state.message}
          </Alert>
        </div>
      ) : null}

      <fieldset className="flex flex-col gap-4">
        <legend className="text-md text-text mb-2 font-semibold">Identity</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Code" required description="Short, e.g. HMBL-IN" errors={errors("code")}>
            {(p) => <Input name="code" defaultValue={value("code")} autoComplete="off" {...p} />}
          </Field>
          <Field label="Legal name" required errors={errors("legalName")} className="sm:col-span-2">
            {(p) => <Input name="legalName" defaultValue={value("legalName")} {...p} />}
          </Field>
        </div>
        <Field label="Trading name" errors={errors("tradingName")}>
          {(p) => <Input name="tradingName" defaultValue={value("tradingName")} {...p} />}
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-md text-text mb-2 font-semibold">Accounting and time</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Country"
            required
            description="ISO code, e.g. IN"
            errors={errors("countryCode")}
          >
            {(p) => (
              <Input name="countryCode" defaultValue={value("countryCode")} maxLength={2} {...p} />
            )}
          </Field>
          <Field
            label="Base currency"
            required
            description="ISO code, e.g. INR"
            errors={errors("baseCurrency")}
          >
            {(p) => (
              <Input
                name="baseCurrency"
                defaultValue={value("baseCurrency")}
                maxLength={3}
                {...p}
              />
            )}
          </Field>
          <Field
            label="Time zone"
            required
            description="e.g. Asia/Kolkata"
            errors={errors("timezone")}
          >
            {(p) => <Input name="timezone" defaultValue={value("timezone")} {...p} />}
          </Field>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-md text-text mb-2 font-semibold">Registered address</legend>
        <Field label="Address line 1" errors={errors("addressLine1")}>
          {(p) => <Input name="addressLine1" defaultValue={value("addressLine1")} {...p} />}
        </Field>
        <Field label="Address line 2" errors={errors("addressLine2")}>
          {(p) => <Input name="addressLine2" defaultValue={value("addressLine2")} {...p} />}
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="City" errors={errors("city")}>
            {(p) => <Input name="city" defaultValue={value("city")} {...p} />}
          </Field>
          <Field label="State or region" errors={errors("region")}>
            {(p) => <Input name="region" defaultValue={value("region")} {...p} />}
          </Field>
          <Field label="Postal code" errors={errors("postalCode")}>
            {(p) => <Input name="postalCode" defaultValue={value("postalCode")} {...p} />}
          </Field>
        </div>
      </fieldset>

      <div className="border-separator flex items-center gap-2 border-t pt-4">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Creating…" : "Create legal entity"}
        </Button>
        <Button asChild variant="quiet">
          <Link href="/admin/organisation">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
