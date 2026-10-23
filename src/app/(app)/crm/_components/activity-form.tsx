"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import { ACTIVITY_TYPES } from "@/server/crm/pipeline-schemas";
import type { FormState } from "@/server/http/action-result";

export function ActivityForm({
  action,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const f = useForm(action, { type: "NOTE" });
  return (
    <form action={f.action} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The activity wasn't added" success="Activity added" />
      {/* Remounting on each result resets the fields and their local state. */}
      <ActivityFields key={f.formKey} form={f} />
    </form>
  );
}

function ActivityFields({ form: f }: { form: ReturnType<typeof useForm> }) {
  const [type, setType] = useState(f.value("type"));
  // datetime-local has no time zone, so send the instant in the user's own zone.
  const [dueAt, setDueAt] = useState("");
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr_14rem]">
        <Field label="Type" errors={f.errors("type")}>
          {(p) => (
            <Select
              name="type"
              defaultValue={f.value("type")}
              onChange={(e) => setType(e.target.value)}
              {...p}
            >
              {Object.entries(ACTIVITY_TYPES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Subject" required errors={f.errors("subject")}>
          {(p) => <Input name="subject" defaultValue={f.value("subject")} {...p} />}
        </Field>
        <Field
          label="Due"
          required={type === "FOLLOW_UP"}
          description={type === "FOLLOW_UP" ? undefined : "Only for follow-ups"}
          errors={f.errors("dueAt")}
        >
          {(p) => (
            <Input
              type="datetime-local"
              disabled={type !== "FOLLOW_UP"}
              onChange={(e) =>
                setDueAt(e.target.value ? new Date(e.target.value).toISOString() : "")
              }
              {...p}
            />
          )}
        </Field>
      </div>
      {type === "FOLLOW_UP" ? <input type="hidden" name="dueAt" value={dueAt} /> : null}
      <Field label="Details" errors={f.errors("body")}>
        {(p) => <Textarea name="body" defaultValue={f.value("body")} rows={2} {...p} />}
      </Field>
      <div>
        <Button type="submit" disabled={f.pending}>
          <Plus aria-hidden />
          {f.pending ? "Adding…" : "Add activity"}
        </Button>
      </div>
    </>
  );
}
