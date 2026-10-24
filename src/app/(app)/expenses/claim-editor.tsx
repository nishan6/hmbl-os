"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import { useUnsavedChangesWarning } from "@/components/ui/use-unsaved-changes";
import { formatMoney } from "@/lib/format";
import { parseMoneyToMinor } from "@/lib/money";
import type { FormState } from "@/server/http/action-result";

export type ClaimRow = {
  id: string;
  date: string;
  categoryId: string;
  description: string;
  merchant: string;
  projectId: string;
  budgetLineId: string;
  amount: string;
  spentCurrency: string;
  spentAmount: string;
  policyNote: string;
};

type CategoryOption = {
  id: string;
  name: string;
  limitMinor: bigint | null;
  limitCurrency: string | null;
  receiptRequired: boolean;
};
type ProjectOption = {
  id: string;
  number: string;
  name: string;
  budgetLines: { id: string; description: string }[];
};

/** A draft claim: one row per expense, each in a category and optionally charged to a project. */
export function ClaimEditor({
  action,
  defaults,
  rows: initialRows,
  categories,
  projects,
  currency,
  today,
  cancelHref,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults: Record<string, string>;
  rows: ClaimRow[];
  categories: CategoryOption[];
  projects: ProjectOption[];
  currency: string;
  today: string;
  cancelHref: string;
}) {
  const f = useForm(action, defaults);
  const markDirty = useUnsavedChangesWarning(f.state);
  const restored = f.state.status === "error" ? f.state.values?.lines : undefined;
  const blank = (): ClaimRow => ({
    id: "",
    date: today,
    categoryId: "",
    description: "",
    merchant: "",
    projectId: "",
    budgetLineId: "",
    amount: "",
    spentCurrency: "",
    spentAmount: "",
    policyNote: "",
  });
  const start = restored ? (JSON.parse(restored) as ClaimRow[]) : initialRows;
  const [rows, setRows] = useState(start.length ? start : [blank()]);
  const amounts = rows.map((r) =>
    r.amount.trim() ? (parseMoneyToMinor(r.amount, currency) ?? 0n) : 0n,
  );
  const total = amounts.reduce((s, a) => s + a, 0n);
  const update = (i: number, patch: Partial<ClaimRow>) => {
    setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    markDirty();
  };
  const change = (next: ClaimRow[]) => {
    setRows(next);
    markDirty();
  };

  return (
    <form
      action={f.action}
      onChange={markDirty}
      key={f.formKey}
      className="flex flex-col gap-6"
      noValidate
    >
      <FormAlert {...f} title="The claim wasn't saved" />
      <input
        type="hidden"
        name="lines"
        value={JSON.stringify(rows.map((r) => ({ ...r, id: r.id || null })))}
      />
      <fieldset className="flex max-w-3xl flex-col gap-4">
        <legend className="text-md text-text mb-2 font-semibold">Claim</legend>
        <Field label="What it was for" required errors={f.errors("title")}>
          {(p) => <Input name="title" defaultValue={f.value("title")} {...p} />}
        </Field>
        <Field label="Notes" errors={f.errors("notes")}>
          {(p) => <Textarea name="notes" defaultValue={f.value("notes")} rows={2} {...p} />}
        </Field>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-md text-text mb-2 font-semibold">Expenses ({currency})</legend>
        <div className="flex flex-col gap-4">
          {rows.map((row, i) => {
            const err = (field: string) => f.errors(`lines.${i}.${field}`);
            const message = (field: string) =>
              err(field) ? (
                <p className="text-danger mt-1 text-xs">{err(field)!.join(" ")}</p>
              ) : null;
            const project = projects.find((p) => p.id === row.projectId);
            const category = categories.find((c) => c.id === row.categoryId);
            const overLimit =
              !!category?.limitMinor &&
              category.limitCurrency === currency &&
              amounts[i]! > category.limitMinor;
            return (
              <div
                key={i}
                className="border-separator grid gap-2 border-b pb-4 sm:grid-cols-[9.5rem_12rem_1fr_9rem_2.5rem]"
              >
                <div>
                  <Input
                    type="date"
                    aria-label={`Expense ${i + 1} date`}
                    value={row.date}
                    max={today}
                    aria-invalid={err("date") ? true : undefined}
                    onChange={(e) => update(i, { date: e.target.value })}
                  />
                  {message("date")}
                </div>
                <div>
                  <Select
                    aria-label={`Expense ${i + 1} category`}
                    value={row.categoryId}
                    aria-invalid={err("categoryId") ? true : undefined}
                    onChange={(e) => update(i, { categoryId: e.target.value })}
                  >
                    <option value="">Category…</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                  {message("categoryId")}
                </div>
                <div>
                  <Input
                    aria-label={`Expense ${i + 1} description`}
                    placeholder="What it was"
                    value={row.description}
                    aria-invalid={err("description") ? true : undefined}
                    onChange={(e) => update(i, { description: e.target.value })}
                  />
                  {message("description")}
                </div>
                <div>
                  <Input
                    aria-label={`Expense ${i + 1} amount in ${currency}`}
                    placeholder="Amount"
                    inputMode="decimal"
                    className="tabular text-right"
                    value={row.amount}
                    aria-invalid={err("amount") ? true : undefined}
                    onChange={(e) => update(i, { amount: e.target.value })}
                  />
                  {message("amount")}
                </div>
                <IconButton
                  label={`Remove expense ${i + 1}`}
                  disabled={rows.length <= 1}
                  onClick={() => change(rows.filter((_, j) => j !== i))}
                >
                  <Trash2 aria-hidden />
                </IconButton>
                <div className="grid gap-2 sm:col-span-5 sm:grid-cols-[1fr_1fr_1fr_6rem_8rem] sm:items-start">
                  <Input
                    aria-label={`Expense ${i + 1} merchant`}
                    placeholder="Paid to (merchant)"
                    value={row.merchant}
                    onChange={(e) => update(i, { merchant: e.target.value })}
                  />
                  <div>
                    <Select
                      aria-label={`Expense ${i + 1} project`}
                      value={row.projectId}
                      aria-invalid={err("projectId") ? true : undefined}
                      onChange={(e) => update(i, { projectId: e.target.value, budgetLineId: "" })}
                    >
                      <option value="">No project</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.number} · {p.name}
                        </option>
                      ))}
                    </Select>
                    {message("projectId")}
                  </div>
                  <div>
                    <Select
                      aria-label={`Expense ${i + 1} budget line`}
                      value={row.budgetLineId}
                      disabled={!project}
                      aria-invalid={err("budgetLineId") ? true : undefined}
                      onChange={(e) => update(i, { budgetLineId: e.target.value })}
                    >
                      <option value="">{project ? "Budget line…" : "No budget line"}</option>
                      {project?.budgetLines.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.description}
                        </option>
                      ))}
                    </Select>
                    {message("budgetLineId")}
                  </div>
                  <div>
                    <Input
                      aria-label={`Expense ${i + 1} currency spent, if not ${currency}`}
                      placeholder="Spent in"
                      maxLength={3}
                      value={row.spentCurrency}
                      aria-invalid={err("spentCurrency") ? true : undefined}
                      onChange={(e) => update(i, { spentCurrency: e.target.value.toUpperCase() })}
                    />
                    {message("spentCurrency")}
                  </div>
                  <div>
                    <Input
                      aria-label={`Expense ${i + 1} amount spent in that currency`}
                      placeholder="Amount spent"
                      inputMode="decimal"
                      className="tabular text-right"
                      disabled={!row.spentCurrency}
                      value={row.spentAmount}
                      aria-invalid={err("spentAmount") ? true : undefined}
                      onChange={(e) => update(i, { spentAmount: e.target.value })}
                    />
                    {message("spentAmount")}
                  </div>
                </div>
                {overLimit || category?.receiptRequired || row.policyNote || err("policyNote") ? (
                  <div className="sm:col-span-5">
                    {overLimit ? (
                      <p className="text-warning mb-1 text-xs">
                        Over the {formatMoney(category!.limitMinor!, currency)} limit for{" "}
                        {category!.name}. Say why below.
                      </p>
                    ) : category?.receiptRequired ? (
                      <p className="text-secondary mb-1 text-xs">
                        Needs a receipt. Attach it on the claim page after saving, or say why there
                        isn&apos;t one.
                      </p>
                    ) : null}
                    <Input
                      aria-label={`Expense ${i + 1} reason for the exception`}
                      placeholder="Reason (over the limit or no receipt)"
                      value={row.policyNote}
                      aria-invalid={err("policyNote") ? true : undefined}
                      onChange={(e) => update(i, { policyNote: e.target.value })}
                    />
                    {message("policyNote")}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <div>
          <Button onClick={() => change([...rows, blank()])}>
            <Plus aria-hidden />
            Add expense
          </Button>
        </div>
        <dl className="ml-auto grid w-72 grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          <dt className="font-semibold">Total</dt>
          <dd className="tabular text-right font-semibold">{formatMoney(total, currency)}</dd>
        </dl>
      </fieldset>
      <div className="bg-surface border-separator sticky bottom-0 -mx-4 flex gap-2 border-t px-4 py-3">
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Saving…" : "Save draft"}
        </Button>
        <Button asChild variant="quiet">
          <Link href={cancelHref}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
