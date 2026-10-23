"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Alert } from "@/components/ui/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useForm } from "@/components/ui/use-form";
import {
  DATE_FORMATS,
  guessMapping,
  parseStatementDate,
  readStatement,
  type DateFormat,
  type StatementMapping,
} from "@/lib/bank-statement";
import { parseCsv } from "@/lib/csv";
import { formatDate, formatMoney } from "@/lib/format";
import type { FormState } from "@/server/http/action-result";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

const COLUMNS = [
  ["date", "Date", true],
  ["description", "Description", true],
  ["reference", "Reference", false],
  ["amount", "Amount (signed)", false],
  ["withdrawal", "Withdrawal", false],
  ["deposit", "Deposit", false],
  ["balance", "Running balance", false],
] as const;

/** The first row in the top twenty that looks like a header: three cells or more, one about a date. */
function findHeader(rows: string[][]) {
  const i = rows
    .slice(0, 20)
    .findIndex((r) => r.filter((c) => c.trim()).length >= 3 && r.some((c) => /date/i.test(c)));
  return i < 0 ? 1 : i + 1;
}

/** The last row whose date cell reads as a date: banks put summaries below the transactions. */
function findLastRow(rows: string[][], headerRow: number, mapping: StatementMapping) {
  for (let i = rows.length - 1; i >= headerRow; i--) {
    if (parseStatementDate((rows[i]![mapping.date] ?? "").trim(), mapping.dateFormat)) return i + 1;
  }
  return rows.length;
}

/**
 * Reads a CSV statement in the browser, guesses which column is which, and
 * shows what will be imported before anything is sent.
 */
export function StatementImportForm({ action, currency }: { action: Action; currency: string }) {
  const f = useForm(action);
  const [file, setFile] = useState<{ name: string; text: string; rows: string[][] } | null>(null);
  const [headerRow, setHeaderRow] = useState(1);
  const [lastRow, setLastRow] = useState(1);
  const [mapping, setMapping] = useState<StatementMapping | null>(null);

  async function choose(chosen: File | undefined) {
    if (!chosen) return setFile(null);
    const text = await chosen.text();
    const rows = parseCsv(text);
    const header = findHeader(rows);
    const guess = guessMapping(rows[header - 1] ?? []);
    const formats = Object.keys(DATE_FORMATS) as DateFormat[];
    // Pick the date format that reads the first transaction.
    const sample = (rows[header]?.[guess.date] ?? "").trim();
    guess.dateFormat = formats.find((d) => parseStatementDate(sample, d)) ?? guess.dateFormat;
    setFile({ name: chosen.name, text, rows });
    setHeaderRow(header);
    setMapping(guess);
    setLastRow(findLastRow(rows, header, guess));
  }

  const headers = file?.rows[headerRow - 1] ?? [];
  const preview = useMemo(() => {
    if (!file || !mapping) return null;
    return readStatement(file.rows.slice(headerRow - 1, lastRow), mapping, currency, headerRow);
  }, [file, mapping, headerRow, lastRow, currency]);
  const moneyIn = preview?.lines.reduce((s, l) => (l.amountMinor > 0n ? s + l.amountMinor : s), 0n);
  const moneyOut = preview?.lines.reduce(
    (s, l) => (l.amountMinor < 0n ? s - l.amountMinor : s),
    0n,
  );

  const set = (key: keyof StatementMapping, value: string) =>
    setMapping((m) =>
      m ? { ...m, [key]: key === "dateFormat" ? value : value === "" ? null : Number(value) } : m,
    );

  return (
    <form action={f.action} className="flex flex-col gap-4" noValidate>
      <FormAlert {...f} title="Nothing was imported" />
      <Field
        label="Statement file (CSV)"
        description="Download the statement from your bank's website as CSV. Excel files: save as CSV first."
        required
        errors={f.errors("text")}
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
      {file && mapping ? (
        <>
          <input type="hidden" name="text" value={file.text} />
          <input type="hidden" name="fileName" value={file.name} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Header row" errors={f.errors("headerRow")}>
              {(p) => (
                <Input
                  type="number"
                  name="headerRow"
                  min={1}
                  max={file.rows.length}
                  value={headerRow}
                  onChange={(e) => setHeaderRow(Math.max(1, Number(e.target.value) || 1))}
                  {...p}
                />
              )}
            </Field>
            <Field label="Last transaction row" errors={f.errors("lastRow")}>
              {(p) => (
                <Input
                  type="number"
                  name="lastRow"
                  min={headerRow + 1}
                  max={file.rows.length}
                  value={lastRow}
                  onChange={(e) => setLastRow(Number(e.target.value) || file.rows.length)}
                  {...p}
                />
              )}
            </Field>
            <Field label="Dates are written" required errors={f.errors("dateFormat")}>
              {(p) => (
                <Select
                  name="dateFormat"
                  value={mapping.dateFormat}
                  onChange={(e) => set("dateFormat", e.target.value)}
                  {...p}
                >
                  {Object.entries(DATE_FORMATS).map(([key, example]) => (
                    <option key={key} value={key}>
                      {key} ({example})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <fieldset className="grid gap-3 sm:grid-cols-4">
            <legend className="text-text mb-2 text-sm font-medium">
              Which column is which? Use one signed amount column, or withdrawal and deposit.
            </legend>
            {COLUMNS.map(([key, label, required]) => (
              <Field key={key} label={label} required={required} errors={f.errors(key)}>
                {(p) => (
                  <Select
                    name={key}
                    value={mapping[key] ?? ""}
                    onChange={(e) => set(key, e.target.value)}
                    {...p}
                  >
                    <option value="">{required ? "Choose…" : "Not in this file"}</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h.trim() || `Column ${i + 1}`}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ))}
          </fieldset>
          {preview?.errors.length ? (
            <Alert tone="danger" title={`${preview.errors.length} rows can't be read yet`}>
              <ul className="list-disc pl-5">
                {preview.errors.slice(0, 5).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </Alert>
          ) : preview ? (
            <Alert
              tone="info"
              title={`${preview.lines.length} transactions: ${formatMoney(moneyIn ?? 0n, currency)} in, ${formatMoney(moneyOut ?? 0n, currency)} out`}
            >
              Lines already imported are skipped.
            </Alert>
          ) : null}
          {preview?.lines.length ? (
            <Table dense>
              <THead>
                <tr>
                  <TH>Row</TH>
                  <TH>Date</TH>
                  <TH>Description</TH>
                  <TH align="right">Amount</TH>
                </tr>
              </THead>
              <TBody>
                {preview.lines.slice(0, 5).map((l) => (
                  <TR key={l.row}>
                    <TD className="tabular text-muted">{l.row}</TD>
                    <TD className="tabular">{formatDate(l.date)}</TD>
                    <TD>{l.description}</TD>
                    <TD align="right" className="tabular">
                      {formatMoney(l.amountMinor, currency)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : null}
        </>
      ) : null}
      <div>
        <Button type="submit" variant="primary" disabled={f.pending || !preview?.lines.length}>
          {f.pending ? "Importing…" : "Import statement"}
        </Button>
      </div>
    </form>
  );
}

/** One statement line typed in from a paper or PDF statement. */
export function StatementLineForm({
  action,
  defaultDate,
}: {
  action: Action;
  defaultDate: string;
}) {
  const f = useForm(action, { date: defaultDate, direction: "out" });
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The line wasn't added" />
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr_10rem]">
        <Field label="Date" required errors={f.errors("date")}>
          {(p) => <Input type="date" name="date" defaultValue={f.value("date")} {...p} />}
        </Field>
        <Field label="Description" required errors={f.errors("description")}>
          {(p) => <Input name="description" defaultValue={f.value("description")} {...p} />}
        </Field>
        <Field label="Reference" errors={f.errors("reference")}>
          {(p) => <Input name="reference" defaultValue={f.value("reference")} {...p} />}
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-[10rem_10rem]">
        <Field label="Money" required errors={f.errors("direction")}>
          {(p) => (
            <Select name="direction" defaultValue={f.value("direction")} {...p}>
              <option value="out">Out (withdrawal)</option>
              <option value="in">In (deposit)</option>
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
      </div>
      <div>
        <Button type="submit" variant="secondary" disabled={f.pending}>
          {f.pending ? "Adding…" : "Add line"}
        </Button>
      </div>
    </form>
  );
}

type LedgerOption = {
  id: string;
  date: string;
  journal: string;
  narration: string;
  amountMinor: string;
  suggested: boolean;
};

/** Ticks the ledger lines that make up a statement line; the total must equal it. */
export function MatchForm({
  action,
  targetMinor,
  currency,
  options,
}: {
  action: Action;
  targetMinor: string;
  currency: string;
  options: LedgerOption[];
}) {
  const f = useForm(action);
  const [chosen, setChosen] = useState<Set<string>>(
    () =>
      new Set(
        options
          .filter((o) => o.suggested)
          .slice(0, 1)
          .map((o) => o.id),
      ),
  );
  const total = options
    .filter((o) => chosen.has(o.id))
    .reduce((s, o) => s + BigInt(o.amountMinor), 0n);
  const target = BigInt(targetMinor);
  const toggle = (id: string) =>
    setChosen((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <form action={f.action} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The line wasn't matched" />
      {options.length ? (
        <Table dense>
          <THead>
            <tr>
              <TH>
                <span className="sr-only">Choose</span>
              </TH>
              <TH>Date</TH>
              <TH>Journal</TH>
              <TH>Narration</TH>
              <TH align="right">Amount</TH>
            </tr>
          </THead>
          <TBody>
            {options.map((o) => (
              <TR key={o.id}>
                <TD>
                  <input
                    type="checkbox"
                    name="journalLineId"
                    value={o.id}
                    checked={chosen.has(o.id)}
                    onChange={() => toggle(o.id)}
                    aria-label={`${o.journal} ${o.narration}`}
                    className="size-4"
                  />
                </TD>
                <TD className="tabular">{o.date}</TD>
                <TD className="tabular">
                  {o.journal}
                  {o.suggested ? <span className="text-accent ml-2 text-xs">Likely</span> : null}
                </TD>
                <TD className="text-secondary">{o.narration}</TD>
                <TD align="right" className="tabular">
                  {formatMoney(BigInt(o.amountMinor), currency)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <p className="text-secondary text-sm">
          No ledger lines with money {target > 0n ? "in" : "out"} are waiting. Post a journal for it
          below.
        </p>
      )}
      {f.errors("journalLineIds")?.map((e) => (
        <p key={e} className="text-danger text-sm">
          {e}
        </p>
      ))}
      <p className="text-secondary tabular text-sm" aria-live="polite">
        Ticked {formatMoney(total, currency)} of {formatMoney(target, currency)}
        {total === target ? " · adds up" : ` · ${formatMoney(target - total, currency)} to go`}
      </p>
      <div>
        <Button
          type="submit"
          variant="primary"
          disabled={f.pending || total !== target || !chosen.size}
        >
          {f.pending ? "Matching…" : "Match"}
        </Button>
      </div>
    </form>
  );
}

/** Posts a journal for a statement line the books don't have yet. */
export function PostLineForm({
  action,
  accounts,
  defaultNarration,
  foreign,
}: {
  action: Action;
  accounts: { id: string; code: string; name: string }[];
  defaultNarration: string;
  /** The bank account's currency and the base currency, when they differ. */
  foreign: { currency: string; base: string } | null;
}) {
  const f = useForm(action, { narration: defaultNarration });
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The journal wasn't posted" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Other account" required errors={f.errors("accountId")}>
          {(p) => (
            <Select name="accountId" defaultValue={f.value("accountId")} {...p}>
              <option value="">Choose…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} {a.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Narration" required errors={f.errors("narration")}>
          {(p) => <Input name="narration" defaultValue={f.value("narration")} {...p} />}
        </Field>
      </div>
      {foreign ? (
        <Field
          label={`Rate (${foreign.base} per 1 ${foreign.currency})`}
          required
          errors={f.errors("fxRate")}
          className="max-w-60"
        >
          {(p) => (
            <Input
              name="fxRate"
              inputMode="decimal"
              className="tabular"
              defaultValue={f.value("fxRate")}
              {...p}
            />
          )}
        </Field>
      ) : null}
      <div>
        <Button type="submit" variant="secondary" disabled={f.pending}>
          {f.pending ? "Posting…" : "Post and match"}
        </Button>
      </div>
    </form>
  );
}

/** Completes the reconciliation shown, after a confirmation. */
export function CompleteForm({
  action,
  date,
  balance,
  label,
}: {
  action: Action;
  date: string;
  balance: string;
  label: string;
}) {
  const f = useForm(action);
  return (
    <form
      action={f.action}
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        if (!window.confirm(`${label}? Matched lines to this date will be locked.`))
          e.preventDefault();
      }}
    >
      <FormAlert {...f} title="The reconciliation wasn't completed" />
      {[...(f.errors("balance") ?? []), ...(f.errors("date") ?? [])].map((e) => (
        <p key={e} className="text-danger text-sm">
          {e}
        </p>
      ))}
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="balance" value={balance} />
      <div>
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Completing…" : label}
        </Button>
      </div>
    </form>
  );
}

/** Reopens the latest reconciliation, with a reason. */
export function ReopenForm({ action }: { action: Action }) {
  const f = useForm(action);
  return (
    <form
      action={f.action}
      key={f.formKey}
      className="flex flex-col gap-3"
      noValidate
      onSubmit={(e) => {
        if (!window.confirm("Reopen this reconciliation? Its lines can then be changed."))
          e.preventDefault();
      }}
    >
      <FormAlert {...f} title="The reconciliation wasn't reopened" />
      <Field label="Reason" required errors={f.errors("reason")}>
        {(p) => <Input name="reason" defaultValue={f.value("reason")} {...p} />}
      </Field>
      <div>
        <Button type="submit" variant="destructive" disabled={f.pending}>
          {f.pending ? "Reopening…" : "Reopen reconciliation"}
        </Button>
      </div>
    </form>
  );
}
