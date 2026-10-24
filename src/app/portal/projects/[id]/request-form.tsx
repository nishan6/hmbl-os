"use client";

import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import { submitInformationAction } from "../../actions";

export function RequestForm({ projectId }: { projectId: string }) {
  const f = useForm(submitInformationAction.bind(null, projectId));
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="Your information wasn't sent" />
      <Field label="Subject" required errors={f.errors("subject")}>
        {(p) => <Input name="subject" defaultValue={f.value("subject")} {...p} />}
      </Field>
      <Field label="Details" required errors={f.errors("body")}>
        {(p) => <Textarea name="body" rows={5} defaultValue={f.value("body")} {...p} />}
      </Field>
      <Button type="submit" variant="primary" disabled={f.pending}>
        {f.pending ? "Sending…" : "Send to HMBL"}
      </Button>
    </form>
  );
}
