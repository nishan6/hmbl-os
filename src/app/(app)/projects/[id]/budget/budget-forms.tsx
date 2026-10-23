"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import { LINE_CATEGORIES } from "@/server/commercial/schemas";
import type { FormState } from "@/server/http/action-result";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;
export type CostCodeOption = { id: string; code: string; name: string; category: string };

function CostCodeSelect({
  name,
  defaultValue,
  category,
  costCodes,
  ...props
}: {
  name: string;
  defaultValue: string;
  category: string;
  costCodes: CostCodeOption[];
} & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Select name={name} defaultValue={defaultValue} {...props}>
      <option value="">None</option>
      {costCodes
        .filter((c) => c.category === category)
        .map((c) => (
          <option key={c.id} value={c.id}>
            {c.code} · {c.name}
          </option>
        ))}
    </Select>
  );
}

/** Adds or changes a line of a draft budget. */
export function DraftLineForm({
  action,
  costCodes,
  defaults = {},
  submitLabel = "Add line",
}: {
  action: Action;
  costCodes: CostCodeOption[];
  defaults?: Record<string, string>;
  submitLabel?: string;
}) {
  const f = useForm(action, { category: "PRODUCTION", quantity: "1", days: "1", ...defaults });
  const [category, setCategory] = useState(f.value("category"));
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The line wasn't saved" />
      {defaults.lineId ? <input type="hidden" name="lineId" value={defaults.lineId} /> : null}
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
        <Field label="Description" required errors={f.errors("description")}>
          {(p) => <Input name="description" defaultValue={f.value("description")} {...p} />}
        </Field>
        <Field label="Category" required errors={f.errors("category")}>
          {(p) => (
            <Select
              name="category"
              defaultValue={f.value("category")}
              onChange={(e) => setCategory(e.target.value)}
              {...p}
            >
              {Object.entries(LINE_CATEGORIES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Cost code" errors={f.errors("costCodeId")}>
          {(p) => (
            <CostCodeSelect
              key={category}
              name="costCodeId"
              defaultValue={f.value("costCodeId")}
              category={category}
              costCodes={costCodes}
              {...p}
            />
          )}
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-6">
        <Field label="Section" errors={f.errors("section")} className="sm:col-span-2">
          {(p) => <Input name="section" defaultValue={f.value("section")} {...p} />}
        </Field>
        <Field label="Qty" errors={f.errors("quantity")}>
          {(p) => (
            <Input name="quantity" inputMode="decimal" defaultValue={f.value("quantity")} {...p} />
          )}
        </Field>
        <Field label="Days" errors={f.errors("days")}>
          {(p) => <Input name="days" inputMode="decimal" defaultValue={f.value("days")} {...p} />}
        </Field>
        <Field label="Budget cost" required errors={f.errors("cost")}>
          {(p) => (
            <Input
              name="cost"
              inputMode="decimal"
              className="tabular"
              defaultValue={f.value("cost")}
              {...p}
            />
          )}
        </Field>
        <Field label="Revenue" errors={f.errors("revenue")}>
          {(p) => (
            <Input
              name="revenue"
              inputMode="decimal"
              className="tabular"
              defaultValue={f.value("revenue")}
              {...p}
            />
          )}
        </Field>
      </div>
      <div>
        <Button type="submit" disabled={f.pending}>
          {defaults.lineId ? null : <Plus aria-hidden />}
          {f.pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** Cost code and the manager's forecast for one line of an approved budget. */
export function LineSettingsForm({
  action,
  costCodes,
  category,
  defaults,
  lineLabel,
}: {
  action: Action;
  costCodes: CostCodeOption[];
  category: string;
  defaults: Record<string, string>;
  lineLabel: string;
}) {
  const f = useForm(action, defaults);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3 py-2" noValidate>
      <FormAlert {...f} title={`${lineLabel} wasn't saved`} />
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem_2fr]">
        <Field label="Cost code" errors={f.errors("costCodeId")}>
          {(p) => (
            <CostCodeSelect
              name="costCodeId"
              defaultValue={f.value("costCodeId")}
              category={category}
              costCodes={costCodes}
              {...p}
            />
          )}
        </Field>
        <Field
          label="Final cost estimate"
          description="Blank: calculated"
          errors={f.errors("forecast")}
        >
          {(p) => (
            <Input
              name="forecast"
              inputMode="decimal"
              className="tabular"
              defaultValue={f.value("forecast")}
              {...p}
            />
          )}
        </Field>
        <Field
          label="Basis of the estimate"
          description="Needed with an estimate"
          errors={f.errors("note")}
        >
          {(p) => <Input name="note" defaultValue={f.value("note")} {...p} />}
        </Field>
      </div>
      <div>
        <Button type="submit" size="sm" disabled={f.pending}>
          {f.pending ? "Saving…" : "Save line"}
        </Button>
      </div>
    </form>
  );
}

export type LineOption = { id: string; label: string };
export type CommitmentOption = { id: string; lineId: string; label: string };

/** Records a commitment or an actual cost. */
export function CostEntryForm({
  action,
  lines,
  commitments,
  today,
}: {
  action: Action;
  lines: LineOption[];
  commitments: CommitmentOption[];
  today: string;
}) {
  const f = useForm(action, { kind: "COMMITMENT", entryDate: today });
  const [kind, setKind] = useState(f.value("kind"));
  const [lineId, setLineId] = useState(f.value("budgetLineId"));
  const onLine = commitments.filter((c) => c.lineId === lineId);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The cost wasn't recorded" />
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr]">
        <Field label="Budget line" required errors={f.errors("budgetLineId")}>
          {(p) => (
            <Select
              name="budgetLineId"
              defaultValue={f.value("budgetLineId")}
              onChange={(e) => setLineId(e.target.value)}
              {...p}
            >
              <option value="">Choose…</option>
              {lines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Type"
          required
          description="Committed: ordered, not billed"
          errors={f.errors("kind")}
        >
          {(p) => (
            <Select
              name="kind"
              defaultValue={f.value("kind")}
              onChange={(e) => setKind(e.target.value)}
              {...p}
            >
              <option value="COMMITMENT">Committed</option>
              <option value="ACTUAL">Actual</option>
            </Select>
          )}
        </Field>
        <Field label="Amount" required errors={f.errors("amount")}>
          {(p) => (
            <Input
              name="amount"
              inputMode="decimal"
              className="tabular"
              defaultValue={f.value("amount")}
              {...p}
            />
          )}
        </Field>
        <Field label="Date" required errors={f.errors("entryDate")}>
          {(p) => <Input name="entryDate" type="date" defaultValue={f.value("entryDate")} {...p} />}
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
        <Field label="Description" required errors={f.errors("description")}>
          {(p) => <Input name="description" defaultValue={f.value("description")} {...p} />}
        </Field>
        <Field label="Supplier" errors={f.errors("supplier")}>
          {(p) => <Input name="supplier" defaultValue={f.value("supplier")} {...p} />}
        </Field>
        <Field
          label="Reference"
          description="PO, bill or receipt number"
          errors={f.errors("reference")}
        >
          {(p) => <Input name="reference" defaultValue={f.value("reference")} {...p} />}
        </Field>
      </div>
      {kind === "ACTUAL" && onLine.length ? (
        <Field
          label="Against commitment"
          description="So the commitment goes down by the same amount"
          errors={f.errors("commitmentId")}
        >
          {(p) => (
            <Select name="commitmentId" defaultValue={f.value("commitmentId")} key={lineId} {...p}>
              <option value="">None</option>
              {onLine.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}
      <div>
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Saving…" : "Record cost"}
        </Button>
      </div>
    </form>
  );
}

/** Voids a cost entry with a reason. */
export function VoidEntryForm({ action, entryId }: { action: Action; entryId: string }) {
  const f = useForm(action);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-2 py-2" noValidate>
      <FormAlert {...f} title="The entry wasn't voided" />
      <input type="hidden" name="entryId" value={entryId} />
      <input type="hidden" name="command" value="void" />
      <Field label="Why void it?" required errors={f.errors("reason")}>
        {(p) => <Textarea name="reason" rows={2} defaultValue={f.value("reason")} {...p} />}
      </Field>
      <div>
        <Button type="submit" size="sm" variant="destructive" disabled={f.pending}>
          Void entry
        </Button>
      </div>
    </form>
  );
}
