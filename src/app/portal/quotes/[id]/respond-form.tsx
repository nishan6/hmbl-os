"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import { acceptQuoteAction, declineQuoteAction } from "../../actions";

/**
 * Accept or decline. The client types their name and ticks the exact
 * statement that is stored with their answer; it is a record of acceptance,
 * not an electronic signature.
 */
export function RespondForms({
  quoteId,
  contentSha256,
  poRequired,
  defaultName,
  statementTemplate,
}: {
  quoteId: string;
  contentSha256: string;
  poRequired: boolean;
  defaultName: string;
  statementTemplate: string;
}) {
  const [mode, setMode] = useState<"accept" | "decline">("accept");
  const accept = useForm(acceptQuoteAction.bind(null, quoteId), { typedName: defaultName });
  const decline = useForm(declineQuoteAction.bind(null, quoteId), { typedName: defaultName });
  const [name, setName] = useState(defaultName);

  if (mode === "decline") {
    return (
      <form
        action={decline.action}
        key={decline.formKey}
        className="flex flex-col gap-3"
        noValidate
      >
        <FormAlert {...decline} title="Your answer wasn't recorded" />
        <input type="hidden" name="contentSha256" value={contentSha256} />
        <Field label="Your name" required errors={decline.errors("typedName")}>
          {(p) => (
            <Input
              name="typedName"
              autoComplete="name"
              defaultValue={decline.value("typedName")}
              {...p}
            />
          )}
        </Field>
        <Field
          label="Why are you declining?"
          description="HMBL sees this. It helps them come back with something better."
          required
          errors={decline.errors("reason")}
        >
          {(p) => <Textarea name="reason" rows={3} defaultValue={decline.value("reason")} {...p} />}
        </Field>
        <Button type="submit" variant="destructive" disabled={decline.pending}>
          {decline.pending ? "Recording…" : "Decline this quotation"}
        </Button>
        <Button type="button" variant="quiet" onClick={() => setMode("accept")}>
          Back to accepting
        </Button>
      </form>
    );
  }

  return (
    <form action={accept.action} key={accept.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...accept} title="Your acceptance wasn't recorded" />
      <input type="hidden" name="contentSha256" value={contentSha256} />
      <Field label="Your name" required errors={accept.errors("typedName")}>
        {(p) => (
          <Input
            name="typedName"
            autoComplete="name"
            defaultValue={accept.value("typedName")}
            onChange={(e) => setName(e.target.value)}
            {...p}
          />
        )}
      </Field>
      <Field
        label="Your purchase order number"
        required={poRequired}
        description={poRequired ? undefined : "If you have one"}
        errors={accept.errors("clientPoNumber")}
      >
        {(p) => (
          <Input name="clientPoNumber" defaultValue={accept.value("clientPoNumber")} {...p} />
        )}
      </Field>
      <label className="text-secondary flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" className="accent-accent mt-0.5 size-4 shrink-0" />
        <span>{statementTemplate.replace("{name}", name.trim() || "[your name]")}</span>
      </label>
      {accept.errors("confirm") ? (
        <p className="text-danger text-xs" role="alert">
          {accept.errors("confirm")?.join(" ")}
        </p>
      ) : null}
      <Button type="submit" variant="primary" disabled={accept.pending}>
        {accept.pending ? "Recording…" : "Accept this quotation"}
      </Button>
      <Button type="button" variant="quiet" onClick={() => setMode("decline")}>
        Decline instead
      </Button>
    </form>
  );
}
