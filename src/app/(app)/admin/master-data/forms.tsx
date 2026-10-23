"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import { PAYMENT_TRIGGERS, TAX_TREATMENTS } from "@/server/master-data/schemas";
import { createPaymentTermAction, createTaxRateAction, createUnitAction } from "./actions";

export function TaxRateForm() {
  const f = useForm(createTaxRateAction, { countryCode: "IN", treatment: "STANDARD" });
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The tax rate wasn't added" success="Tax rate added" />
      <div className="grid gap-3 sm:grid-cols-5">
        <Field label="Country" required description="ISO code" errors={f.errors("countryCode")}>
          {(p) => (
            <Input name="countryCode" defaultValue={f.value("countryCode")} maxLength={2} {...p} />
          )}
        </Field>
        <Field label="Code" required description="e.g. GST12" errors={f.errors("code")}>
          {(p) => <Input name="code" defaultValue={f.value("code")} {...p} />}
        </Field>
        <Field label="Name" required description="As printed" errors={f.errors("name")}>
          {(p) => <Input name="name" defaultValue={f.value("name")} {...p} />}
        </Field>
        <Field label="Treatment" errors={f.errors("treatment")}>
          {(p) => (
            <Select name="treatment" defaultValue={f.value("treatment")} {...p}>
              {Object.entries(TAX_TREATMENTS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Rate %" required description="e.g. 18" errors={f.errors("rate")}>
          {(p) => <Input name="rate" inputMode="decimal" defaultValue={f.value("rate")} {...p} />}
        </Field>
      </div>
      <div>
        <Button type="submit" disabled={f.pending}>
          <Plus aria-hidden />
          {f.pending ? "Adding…" : "Add tax rate"}
        </Button>
      </div>
    </form>
  );
}

type Row = { key: number; label: string; percent: string; trigger: string; days: string };

export function PaymentTermForm() {
  const f = useForm(createPaymentTermAction);
  const [rows, setRows] = useState<Row[]>([
    { key: 0, label: "Advance", percent: "50", trigger: "ON_ACCEPTANCE", days: "0" },
    { key: 1, label: "Balance", percent: "50", trigger: "ON_DELIVERY", days: "0" },
  ]);
  const update = (key: number, patch: Partial<Row>) =>
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const total = rows.reduce((sum, r) => sum + (Number(r.percent) || 0), 0);

  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The payment term wasn't added" success="Payment term added" />
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Code" required description="e.g. ADV30" errors={f.errors("code")}>
          {(p) => <Input name="code" defaultValue={f.value("code")} {...p} />}
        </Field>
        <Field label="Name" required errors={f.errors("name")} className="sm:col-span-2">
          {(p) => <Input name="name" defaultValue={f.value("name")} {...p} />}
        </Field>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-text mb-1 text-sm font-medium">Instalments</legend>
        {rows.map((r, i) => (
          <div key={r.key} className="grid grid-cols-[1fr_6rem_1fr_5rem_auto] items-end gap-2">
            <Field label={`Instalment ${i + 1} label`}>
              {(p) => (
                <Input
                  name={`instalments.${i}.label`}
                  value={r.label}
                  onChange={(e) => update(r.key, { label: e.target.value })}
                  {...p}
                />
              )}
            </Field>
            <Field label="Percent">
              {(p) => (
                <Input
                  name={`instalments.${i}.percent`}
                  inputMode="decimal"
                  value={r.percent}
                  onChange={(e) => update(r.key, { percent: e.target.value })}
                  {...p}
                />
              )}
            </Field>
            <Field label="Due">
              {(p) => (
                <Select
                  name={`instalments.${i}.trigger`}
                  value={r.trigger}
                  onChange={(e) => update(r.key, { trigger: e.target.value })}
                  {...p}
                >
                  {Object.entries(PAYMENT_TRIGGERS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Days">
              {(p) => (
                <Input
                  name={`instalments.${i}.days`}
                  inputMode="numeric"
                  value={r.days}
                  disabled={r.trigger !== "BEFORE_START" && r.trigger !== "AFTER_DELIVERY"}
                  onChange={(e) => update(r.key, { days: e.target.value })}
                  {...p}
                />
              )}
            </Field>
            <IconButton
              label={`Remove instalment ${i + 1}`}
              disabled={rows.length === 1}
              onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))}
            >
              <X aria-hidden />
            </IconButton>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3">
          <Button
            size="sm"
            variant="quiet"
            onClick={() =>
              setRows((list) => [
                ...list,
                {
                  key: Math.max(...list.map((x) => x.key)) + 1,
                  label: "",
                  percent: "",
                  trigger: "ON_DELIVERY",
                  days: "0",
                },
              ])
            }
          >
            <Plus aria-hidden />
            Add instalment
          </Button>
          <p className={total === 100 ? "text-secondary text-sm" : "text-warning text-sm"}>
            <span className="tabular">{total}%</span> of 100%
          </p>
        </div>
        {f.errors("instalments") ? (
          <p className="text-danger text-xs">{f.errors("instalments")!.join(" ")}</p>
        ) : null}
      </fieldset>
      <div>
        <Button type="submit" disabled={f.pending}>
          <Plus aria-hidden />
          {f.pending ? "Adding…" : "Add payment term"}
        </Button>
      </div>
    </form>
  );
}

export function UnitForm() {
  const f = useForm(createUnitAction);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The unit wasn't added" success="Unit added" />
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr_auto] sm:items-end">
        <Field label="Code" required errors={f.errors("code")}>
          {(p) => <Input name="code" defaultValue={f.value("code")} {...p} />}
        </Field>
        <Field label="Name" required errors={f.errors("name")}>
          {(p) => <Input name="name" defaultValue={f.value("name")} {...p} />}
        </Field>
        <Button type="submit" disabled={f.pending}>
          <Plus aria-hidden />
          {f.pending ? "Adding…" : "Add unit"}
        </Button>
      </div>
    </form>
  );
}
