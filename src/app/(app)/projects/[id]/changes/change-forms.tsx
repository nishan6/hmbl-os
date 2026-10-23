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

/** Title, reason and impacts of a change order. */
export function ChangeDetailsForm({
  action,
  defaults = {},
  submitLabel,
}: {
  action: Action;
  defaults?: Record<string, string>;
  submitLabel: string;
}) {
  const f = useForm(action, defaults);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The change order wasn't saved" />
      <Field label="Title" required errors={f.errors("title")}>
        {(p) => <Input name="title" defaultValue={f.value("title")} {...p} />}
      </Field>
      <Field
        label="Reason"
        required
        description="Why the change is needed and who asked for it"
        errors={f.errors("reason")}
      >
        {(p) => <Textarea name="reason" rows={2} defaultValue={f.value("reason")} {...p} />}
      </Field>
      <Field label="Description" errors={f.errors("description")}>
        {(p) => (
          <Textarea name="description" rows={2} defaultValue={f.value("description")} {...p} />
        )}
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Scope impact" errors={f.errors("scopeImpact")}>
          {(p) => (
            <Textarea name="scopeImpact" rows={2} defaultValue={f.value("scopeImpact")} {...p} />
          )}
        </Field>
        <Field label="Schedule impact" errors={f.errors("scheduleImpact")}>
          {(p) => (
            <Textarea
              name="scheduleImpact"
              rows={2}
              defaultValue={f.value("scheduleImpact")}
              {...p}
            />
          )}
        </Field>
      </div>
      <Field
        label="Schedule change in days"
        description="Positive delays the end, negative brings it forward"
        errors={f.errors("scheduleImpactDays")}
        className="max-w-48"
      >
        {(p) => (
          <Input
            name="scheduleImpactDays"
            inputMode="numeric"
            defaultValue={f.value("scheduleImpactDays")}
            {...p}
          />
        )}
      </Field>
      <div>
        <Button
          type="submit"
          variant={defaults.title ? "secondary" : "primary"}
          disabled={f.pending}
        >
          {f.pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

export type BudgetLineOption = { id: string; label: string };
export type CostCodeOption = { id: string; code: string; name: string; category: string };

/** One budget movement: an existing line up or down, or a new line. */
export function ChangeLineForm({
  action,
  lines,
  costCodes,
  showCosts,
}: {
  action: Action;
  lines: BudgetLineOption[];
  costCodes: CostCodeOption[];
  showCosts: boolean;
}) {
  const f = useForm(action, { budgetLineId: lines[0]?.id ?? "new", newCategory: "PRODUCTION" });
  const [target, setTarget] = useState(f.value("budgetLineId"));
  const [category, setCategory] = useState(f.value("newCategory"));
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The change wasn't saved" />
      <Field label="Budget line" required errors={f.errors("budgetLineId")}>
        {(p) => (
          <Select
            name="budgetLineId"
            defaultValue={f.value("budgetLineId")}
            onChange={(e) => setTarget(e.target.value)}
            {...p}
          >
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
            <option value="new">A new line…</option>
          </Select>
        )}
      </Field>
      {target === "new" ? (
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
          <Field label="New line" required errors={f.errors("newDescription")}>
            {(p) => <Input name="newDescription" defaultValue={f.value("newDescription")} {...p} />}
          </Field>
          <Field label="Category" required errors={f.errors("newCategory")}>
            {(p) => (
              <Select
                name="newCategory"
                defaultValue={f.value("newCategory")}
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
          <Field label="Cost code" errors={f.errors("newCostCodeId")}>
            {(p) => (
              <Select
                name="newCostCodeId"
                defaultValue={f.value("newCostCodeId")}
                key={category}
                {...p}
              >
                <option value="">None</option>
                {costCodes
                  .filter((c) => c.category === category)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} · {c.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr]">
        {showCosts ? (
          <Field label="Cost change" description="e.g. 25000 or -5000" errors={f.errors("cost")}>
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
        ) : null}
        <Field label="Revenue change" description="Before tax" errors={f.errors("revenue")}>
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
        <Field label="Note" errors={f.errors("note")}>
          {(p) => <Input name="note" defaultValue={f.value("note")} {...p} />}
        </Field>
      </div>
      <div>
        <Button type="submit" disabled={f.pending}>
          <Plus aria-hidden />
          {f.pending ? "Saving…" : "Add change"}
        </Button>
      </div>
    </form>
  );
}

/** How and when the client agreed. */
export function ClientApprovalForm({
  action,
  defaults,
  methods,
}: {
  action: Action;
  defaults: Record<string, string>;
  methods: Record<string, string>;
}) {
  const f = useForm(action, defaults);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The client's agreement wasn't recorded" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Agreed on" required errors={f.errors("clientApprovedOn")}>
          {(p) => (
            <Input
              name="clientApprovedOn"
              type="date"
              defaultValue={f.value("clientApprovedOn")}
              {...p}
            />
          )}
        </Field>
        <Field label="Agreed by" required errors={f.errors("clientApprovedByName")}>
          {(p) => (
            <Input
              name="clientApprovedByName"
              defaultValue={f.value("clientApprovedByName")}
              {...p}
            />
          )}
        </Field>
        <Field label="How" required errors={f.errors("clientApprovalMethod")}>
          {(p) => (
            <Select
              name="clientApprovalMethod"
              defaultValue={f.value("clientApprovalMethod")}
              {...p}
            >
              <option value="">Choose…</option>
              {Object.entries(methods).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Reference"
          description="Email subject, PO number…"
          errors={f.errors("clientApprovalReference")}
        >
          {(p) => (
            <Input
              name="clientApprovalReference"
              defaultValue={f.value("clientApprovalReference")}
              {...p}
            />
          )}
        </Field>
      </div>
      <div>
        <Button type="submit" disabled={f.pending}>
          {f.pending ? "Saving…" : "Record client agreement"}
        </Button>
      </div>
    </form>
  );
}

/** A workflow step with an optional or required comment. */
export function CommandForm({
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
