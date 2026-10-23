"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

type Stage = { id: string; name: string; kind: string };

const CLOSED = new Set(["WON", "LOST", "CANCELLED"]);
const NEEDS_REASON = new Set(["LOST", "ON_HOLD", "CANCELLED"]);

/** Moves an opportunity to another stage, asking for a reason when the rules need one. */
export function StageForm({
  action,
  stages,
  current,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  stages: Stage[];
  current: Stage;
}) {
  const f = useForm(action);
  const [targetId, setTargetId] = useState("");
  const target = stages.find((s) => s.id === targetId);
  const reopening = target && CLOSED.has(current.kind) && !CLOSED.has(target.kind);
  const needsReason = target && (NEEDS_REASON.has(target.kind) || reopening);

  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The stage didn't change" />
      <div className="grid gap-3 sm:grid-cols-[14rem_1fr_auto] sm:items-end">
        <Field label="Move to" errors={f.errors("stageId")}>
          {(p) => (
            <Select
              name="stageId"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              {...p}
            >
              <option value="">Choose a stage…</option>
              {stages
                .filter((s) => s.id !== current.id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field
          label={reopening ? "Why reopen it?" : "Reason"}
          required={Boolean(needsReason)}
          errors={f.errors("reason")}
        >
          {(p) => (
            <Input
              name="reason"
              defaultValue={f.value("reason")}
              placeholder={target?.kind === "LOST" ? "e.g. Budget went to another vendor" : ""}
              {...p}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" disabled={f.pending || !targetId}>
          {f.pending ? "Moving…" : "Move"}
        </Button>
      </div>
    </form>
  );
}
