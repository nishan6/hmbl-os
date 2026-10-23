"use client";

import Link from "next/link";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import { useUnsavedChangesWarning } from "@/components/ui/use-unsaved-changes";
import { formatMoney } from "@/lib/format";
import { journalTotals } from "@/lib/ledger";
import { parseMoneyToMinor } from "@/lib/money";
import type { FormState } from "@/server/http/action-result";

export type JournalRow = {
  accountId: string;
  description: string;
  projectId: string;
  debit: string;
  credit: string;
};

type AccountOption = { id: string; code: string; name: string; isControl: boolean };
type ProjectOption = { id: string; number: string; name: string };

const blank = (): JournalRow => ({
  accountId: "",
  description: "",
  projectId: "",
  debit: "",
  credit: "",
});

/** A manual journal: date, narration and balanced debit and credit lines. */
export function JournalEditor({
  action,
  defaults,
  rows: initialRows,
  accounts,
  projects,
  currency,
  cancelHref,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  defaults: Record<string, string>;
  rows: JournalRow[];
  accounts: AccountOption[];
  projects: ProjectOption[];
  currency: string;
  cancelHref: string;
}) {
  const f = useForm(action, defaults);
  const markDirty = useUnsavedChangesWarning(f.state);
  const restored = f.state.status === "error" ? f.state.values?.lines : undefined;
  return (
    <form
      action={f.action}
      onChange={markDirty}
      key={f.formKey}
      className="flex flex-col gap-6"
      noValidate
    >
      <FormAlert {...f} title="The journal wasn't saved" />
      <Body
        f={f}
        initialRows={restored ? (JSON.parse(restored) as JournalRow[]) : initialRows}
        accounts={accounts.filter((a) => !a.isControl)}
        projects={projects}
        currency={currency}
        markDirty={markDirty}
      />
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

function Body({
  f,
  initialRows,
  accounts,
  projects,
  currency,
  markDirty,
}: {
  f: ReturnType<typeof useForm>;
  initialRows: JournalRow[];
  accounts: AccountOption[];
  projects: ProjectOption[];
  currency: string;
  markDirty: () => void;
}) {
  const [rows, setRows] = useState(initialRows.length ? initialRows : [blank(), blank()]);
  const amount = (v: string) => (v.trim() ? (parseMoneyToMinor(v, currency) ?? 0n) : 0n);
  const totals = journalTotals(
    rows.map((r) => ({ debitMinor: amount(r.debit), creditMinor: amount(r.credit) })),
  );
  const money = (minor: bigint) => formatMoney(minor, currency);
  const update = (i: number, patch: Partial<JournalRow>) =>
    setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const change = (next: JournalRow[]) => {
    setRows(next);
    markDirty();
  };

  return (
    <>
      <input type="hidden" name="lines" value={JSON.stringify(rows)} />
      <fieldset className="max-w-form flex flex-col gap-4">
        <legend className="text-md text-text mb-2 font-semibold">Journal</legend>
        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <Field label="Date" required errors={f.errors("date")}>
            {(p) => <Input type="date" name="date" defaultValue={f.value("date")} {...p} />}
          </Field>
          <Field
            label="Narration"
            required
            description="What the journal records and why"
            errors={f.errors("narration")}
          >
            {(p) => <Input name="narration" defaultValue={f.value("narration")} {...p} />}
          </Field>
        </div>
        <label className="text-text flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="openingBalance"
            defaultChecked={
              f.value("openingBalance") === "true" || f.value("openingBalance") === "on"
            }
          />
          Opening balances (moving existing books into HMBL OS)
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="text-md text-text mb-2 font-semibold">Lines</legend>
        <p className="text-secondary -mt-2 text-sm">
          Each line is a debit or a credit. Receivables, payables and advances aren&apos;t listed:
          their documents post them.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] border-collapse text-sm">
            <thead>
              <tr className="text-secondary text-left text-xs">
                <th className="py-1 pr-2 font-medium">Account</th>
                <th className="py-1 pr-2 font-medium">Description</th>
                <th className="py-1 pr-2 font-medium">Project</th>
                <th className="w-36 py-1 pr-2 text-right font-medium">Debit</th>
                <th className="w-36 py-1 pr-2 text-right font-medium">Credit</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const err = (field: string) => f.errors(`lines.${i}.${field}`);
                return (
                  <tr key={i} className="align-top">
                    <td className="py-1 pr-2">
                      <Select
                        aria-label={`Line ${i + 1} account`}
                        value={row.accountId}
                        aria-invalid={err("accountId") ? true : undefined}
                        onChange={(e) => update(i, { accountId: e.target.value })}
                      >
                        <option value="">Choose…</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} · {a.name}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="py-1 pr-2">
                      <Input
                        aria-label={`Line ${i + 1} description`}
                        value={row.description}
                        onChange={(e) => update(i, { description: e.target.value })}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <Select
                        aria-label={`Line ${i + 1} project`}
                        value={row.projectId}
                        onChange={(e) => update(i, { projectId: e.target.value })}
                      >
                        <option value="">None</option>
                        {projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.number} · {p.name}
                          </option>
                        ))}
                      </Select>
                    </td>
                    {(["debit", "credit"] as const).map((side) => (
                      <td key={side} className="py-1 pr-2">
                        <Input
                          aria-label={`Line ${i + 1} ${side}`}
                          inputMode="decimal"
                          className="tabular text-right"
                          value={row[side]}
                          aria-invalid={err(side) ? true : undefined}
                          onChange={(e) => update(i, { [side]: e.target.value })}
                        />
                        {err(side) ? (
                          <p className="text-danger mt-1 text-xs">{err(side)!.join(" ")}</p>
                        ) : null}
                      </td>
                    ))}
                    <td className="py-1">
                      <IconButton
                        label={`Remove line ${i + 1}`}
                        disabled={rows.length <= 2}
                        onClick={() => change(rows.filter((_, j) => j !== i))}
                      >
                        <Trash2 aria-hidden />
                      </IconButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-separator border-t font-medium">
                <td colSpan={3} className="py-2 pr-2">
                  Totals
                  {totals.differenceMinor !== 0n ? (
                    <span className="text-warning ml-3 text-sm font-normal" role="status">
                      Out of balance by{" "}
                      {money(
                        totals.differenceMinor < 0n
                          ? -totals.differenceMinor
                          : totals.differenceMinor,
                      )}
                    </span>
                  ) : null}
                </td>
                <td className="tabular py-2 pr-2 text-right">{money(totals.debitMinor)}</td>
                <td className="tabular py-2 pr-2 text-right">{money(totals.creditMinor)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <div>
          <Button onClick={() => change([...rows, blank()])}>
            <Plus aria-hidden />
            Add line
          </Button>
        </div>
      </fieldset>
    </>
  );
}
