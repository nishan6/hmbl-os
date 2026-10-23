"use client";

import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** Sends a submitted bill back to Finance with a reason. */
export function RejectBillForm({ action }: { action: Action }) {
  const f = useForm(action, {});
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The bill wasn't sent back" />
      <Field label="What needs fixing" required errors={f.errors("reason")}>
        {(p) => <Input name="reason" defaultValue={f.value("reason")} {...p} />}
      </Field>
      <div>
        <Button type="submit" disabled={f.pending}>
          {f.pending ? "Sending back…" : "Send back to Finance"}
        </Button>
      </div>
    </form>
  );
}

/** Voids an approved, unpaid bill on a date, with a reason. */
export function VoidBillForm({ action, defaultDate }: { action: Action; defaultDate: string }) {
  const f = useForm(action, { date: defaultDate });
  return (
    <form
      action={f.action}
      key={f.formKey}
      className="flex flex-col gap-3"
      noValidate
      onSubmit={(e) => {
        if (!window.confirm("Void this bill? Its journal and project costs are reversed.")) {
          e.preventDefault();
        }
      }}
    >
      <FormAlert {...f} title="The bill wasn't voided" />
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <Field label="Void date" required errors={f.errors("date")}>
          {(p) => <Input type="date" name="date" defaultValue={f.value("date")} {...p} />}
        </Field>
        <Field label="Reason" required errors={f.errors("reason")}>
          {(p) => <Input name="reason" defaultValue={f.value("reason")} {...p} />}
        </Field>
      </div>
      <div>
        <Button type="submit" variant="destructive" disabled={f.pending}>
          {f.pending ? "Voiding…" : "Void bill"}
        </Button>
      </div>
    </form>
  );
}
