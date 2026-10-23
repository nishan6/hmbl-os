"use client";

import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

export type Allowed = {
  submit: boolean;
  approve: boolean;
  reject: boolean;
  issue: boolean;
  revise: boolean;
  withdraw: boolean;
};

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** The workflow buttons for the latest version. The server re-checks every step. */
export function QuoteActions({
  action,
  allowed,
  ready,
}: {
  action: Action;
  allowed: Allowed;
  ready: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {allowed.approve || allowed.reject ? (
        <CommentForm
          action={action}
          title="Your decision"
          label="Comment"
          description="Required when sending it back. Shown in the approval history"
          buttons={[
            ...(allowed.approve ? [{ command: "approve", label: "Approve", primary: true }] : []),
            ...(allowed.reject ? [{ command: "reject", label: "Send back to draft" }] : []),
          ]}
        />
      ) : null}
      {allowed.submit ? (
        <CommentForm
          action={action}
          title="Needs the Director's approval"
          label="Note for the approver"
          disabled={!ready}
          buttons={[{ command: "submit", label: "Submit for approval", primary: true }]}
        />
      ) : null}
      {allowed.issue ? (
        <CommentForm
          action={action}
          title="Send to the client"
          description="Print or save the quote, send it, then mark it issued. The version is then locked; changes need a revision."
          disabled={!ready}
          buttons={[{ command: "issue", label: "Mark as issued", primary: true }]}
        />
      ) : null}
      {allowed.revise ? (
        <CommentForm
          action={action}
          title="Change it"
          description="Starts the next version as a draft copy. This version stays in the history."
          buttons={[{ command: "revise", label: "Create a revision" }]}
        />
      ) : null}
      {allowed.withdraw ? (
        <details className="text-sm">
          <summary className="text-secondary hover:text-text cursor-pointer">
            Withdraw this quote
          </summary>
          <div className="mt-3">
            <CommentForm
              action={action}
              label="Reason"
              required
              buttons={[{ command: "withdraw", label: "Withdraw", destructive: true }]}
            />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function CommentForm({
  action,
  title,
  description,
  label,
  required,
  disabled,
  buttons,
}: {
  action: Action;
  title?: string;
  description?: string;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  buttons: { command: string; label: string; primary?: boolean; destructive?: boolean }[];
}) {
  const f = useForm(action);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      {title ? <h3 className="text-text text-sm font-semibold">{title}</h3> : null}
      {description ? <p className="text-secondary -mt-2 text-sm">{description}</p> : null}
      <FormAlert {...f} title="That didn't work" />
      {label ? (
        <Field label={label} required={required} errors={f.errors("comment")}>
          {(p) => <Textarea name="comment" rows={2} defaultValue={f.value("comment")} {...p} />}
        </Field>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {buttons.map((b) => (
          <Button
            key={b.command}
            type="submit"
            name="command"
            value={b.command}
            variant={b.destructive ? "destructive" : b.primary ? "primary" : "secondary"}
            disabled={f.pending || disabled}
          >
            {b.label}
          </Button>
        ))}
      </div>
    </form>
  );
}
