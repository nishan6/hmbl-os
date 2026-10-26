"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import { IMPORT_KINDS, IMPORT_LIMITS, type ImportKind } from "@/lib/imports";
import type { FormState } from "@/server/http/action-result";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** Reads the CSV in the browser and stages it. Nothing is imported until it is committed. */
export function NewImportForm({ action, kinds }: { action: Action; kinds: ImportKind[] }) {
  const f = useForm(action);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [tooBig, setTooBig] = useState(false);

  async function choose(chosen: File | undefined) {
    setTooBig(false);
    if (!chosen) return setFile(null);
    if (chosen.size > IMPORT_LIMITS.bytes) {
      setTooBig(true);
      return setFile(null);
    }
    setFile({ name: chosen.name, text: await chosen.text() });
  }

  return (
    <form action={f.action} key={f.formKey} className="flex max-w-xl flex-col gap-4" noValidate>
      <FormAlert {...f} title="The file wasn't read" />
      <Field label="What the file holds" required errors={f.errors("kind")}>
        {(p) => (
          <Select name="kind" defaultValue={f.value("kind") || kinds[0]} {...p}>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {IMPORT_KINDS[k].label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label="File (CSV)"
        description={`The first row must be the column names. At most ${IMPORT_LIMITS.rows.toLocaleString("en-IN")} rows and 2 MB. Excel files: save as CSV first.`}
        required
        errors={tooBig ? ["The file is over 2 MB. Split it into smaller files."] : f.errors("text")}
      >
        {(p) => (
          <Input
            type="file"
            accept=".csv,text/csv"
            className="h-auto py-1.5"
            onChange={(e) => void choose(e.target.files?.[0])}
            {...p}
          />
        )}
      </Field>
      {file ? (
        <>
          <input type="hidden" name="text" value={file.text} />
          <input type="hidden" name="fileName" value={file.name} />
        </>
      ) : null}
      <div>
        <Button type="submit" disabled={f.pending || !file}>
          {f.pending ? "Reading the file…" : "Read and check the file"}
        </Button>
      </div>
    </form>
  );
}
