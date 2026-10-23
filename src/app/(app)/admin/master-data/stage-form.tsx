"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import { STAGE_KINDS } from "@/server/crm/pipeline-schemas";
import { createStageAction } from "./actions";

export function StageForm() {
  const f = useForm(createStageAction, { kind: "OPEN" });
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The stage wasn't added" success="Stage added at the end" />
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem_10rem_auto] sm:items-end">
        <Field label="Stage name" required errors={f.errors("name")}>
          {(p) => <Input name="name" defaultValue={f.value("name")} {...p} />}
        </Field>
        <Field label="Kind" errors={f.errors("kind")}>
          {(p) => (
            <Select name="kind" defaultValue={f.value("kind")} {...p}>
              {Object.entries(STAGE_KINDS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Probability %" errors={f.errors("probability")}>
          {(p) => (
            <Input
              name="probability"
              inputMode="decimal"
              defaultValue={f.value("probability")}
              {...p}
            />
          )}
        </Field>
        <Button type="submit" disabled={f.pending}>
          <Plus aria-hidden />
          {f.pending ? "Adding…" : "Add stage"}
        </Button>
      </div>
    </form>
  );
}
