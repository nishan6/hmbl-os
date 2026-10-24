"use client";

import { useState } from "react";
import Link from "next/link";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;
type Option = { id: string; label: string };
type Form = ReturnType<typeof useForm>;

function text(
  f: Form,
  name: string,
  label: string,
  options: {
    required?: boolean;
    description?: string;
    type?: string;
    className?: string;
    inputMode?: "decimal" | "numeric";
  } = {},
) {
  return (
    <Field
      label={label}
      required={options.required}
      description={options.description}
      errors={f.errors(name)}
    >
      {(p) => (
        <Input
          name={name}
          type={options.type}
          inputMode={options.inputMode}
          className={options.className}
          defaultValue={f.value(name)}
          {...p}
        />
      )}
    </Field>
  );
}

function select(
  f: Form,
  name: string,
  label: string,
  options: Option[],
  extra: { required?: boolean; description?: string; blank?: string } = {},
) {
  return (
    <Field
      label={label}
      required={extra.required}
      description={extra.description}
      errors={f.errors(name)}
    >
      {(p) => (
        <Select name={name} defaultValue={f.value(name)} {...p}>
          {extra.blank !== undefined ? <option value="">{extra.blank}</option> : null}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

const fromRecord = (r: Record<string, string>) =>
  Object.entries(r).map(([id, label]) => ({ id, label }));

function Submit({
  pending,
  label,
  primary,
}: {
  pending: boolean;
  label: string;
  primary?: boolean;
}) {
  return (
    <div>
      <Button type="submit" variant={primary ? "primary" : undefined} disabled={pending}>
        {pending ? "Saving…" : label}
      </Button>
    </div>
  );
}

/** An item: what it is, how it is tracked, and what it charges, costs and is worth. */
export function ItemForm({
  action,
  defaults,
  categories,
  tracking,
  trackingLocked,
  submitLabel,
  cancelHref,
}: {
  action: Action;
  defaults: Record<string, string>;
  categories: Option[];
  tracking: Record<string, string>;
  trackingLocked?: boolean;
  submitLabel: string;
  cancelHref?: string;
}) {
  const f = useForm(action, defaults);
  return (
    <form action={f.action} key={f.formKey} className="flex max-w-3xl flex-col gap-6" noValidate>
      <FormAlert {...f} title="The item wasn't saved" />
      <fieldset className="flex flex-col gap-3">
        <legend className="text-md text-text mb-2 font-semibold">Item</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {text(f, "name", "Name", { required: true })}
          {text(f, "sku", "SKU", {
            required: true,
            description: "Your code for this item, e.g. ML-MEGA",
            className: "uppercase",
          })}
          {select(f, "categoryId", "Category", categories, { required: true, blank: "Choose…" })}
          {trackingLocked ? (
            <>
              <input type="hidden" name="tracking" value={f.value("tracking")} />
              <Field label="Tracked" description="Fixed once it has assets or stock">
                {(p) => <Input value={tracking[f.value("tracking")] ?? ""} readOnly {...p} />}
              </Field>
            </>
          ) : (
            select(f, "tracking", "Tracked", fromRecord(tracking), {
              required: true,
              description: "Serialised units such as fixtures, or counts such as cable",
            })
          )}
          {text(f, "manufacturer", "Manufacturer")}
          {text(f, "model", "Model")}
        </div>
        <Field label="Description" errors={f.errors("description")}>
          {(p) => (
            <Textarea name="description" rows={2} defaultValue={f.value("description")} {...p} />
          )}
        </Field>
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-md text-text mb-2 font-semibold">Rates and value</legend>
        <p className="text-secondary -mt-2 text-sm">
          Per unit, before tax. The internal cost is for comparison and is never posted.
        </p>
        <div className="grid gap-3 sm:grid-cols-4">
          {text(f, "currency", "Currency", { required: true, className: "uppercase" })}
          {text(f, "rentalDayRate", "Rental per day", {
            inputMode: "decimal",
            className: "tabular",
          })}
          {text(f, "internalDayCost", "Internal cost per day", {
            inputMode: "decimal",
            className: "tabular",
          })}
          {text(f, "replacementValue", "Replacement value", {
            inputMode: "decimal",
            className: "tabular",
          })}
        </div>
      </fieldset>
      <Field label="Notes" errors={f.errors("notes")}>
        {(p) => <Textarea name="notes" rows={2} defaultValue={f.value("notes")} {...p} />}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Saving…" : submitLabel}
        </Button>
        {cancelHref ? (
          <Link href={cancelHref} className={buttonClasses("secondary")}>
            Cancel
          </Link>
        ) : null}
      </div>
    </form>
  );
}

/** One serialised unit: tag, serial, where it is, who owns it, and how it was bought. */
export function AssetForm({
  action,
  defaults,
  locations,
  entities,
  vendors,
  ownership,
  submitLabel,
}: {
  action: Action;
  defaults: Record<string, string>;
  locations: Option[];
  entities: Option[];
  vendors: Option[];
  ownership: Record<string, string>;
  submitLabel: string;
}) {
  const f = useForm(action, defaults);
  return (
    <form action={f.action} key={f.formKey} className="flex max-w-3xl flex-col gap-4" noValidate>
      <FormAlert {...f} title="The asset wasn't saved" />
      <div className="grid gap-3 sm:grid-cols-3">
        {text(f, "assetTag", "Asset tag", { required: true, className: "uppercase" })}
        {text(f, "serialNumber", "Serial number")}
        {select(f, "locationId", "Kept at", locations, { blank: "Not recorded" })}
        {select(f, "ownership", "Ownership", fromRecord(ownership), { required: true })}
        {select(f, "legalEntityId", "Owned by", entities, { blank: "Not recorded" })}
        {text(f, "warrantyUntil", "Warranty until", { type: "date" })}
      </div>
      <fieldset className="flex flex-col gap-3">
        <legend className="text-text mb-1 text-sm font-semibold">Purchase</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {text(f, "purchasedOn", "Bought on", { type: "date" })}
          {select(f, "purchasedFromId", "Bought from", vendors, { blank: "Not recorded" })}
          {text(f, "purchaseReference", "Invoice or PO reference")}
          {text(f, "purchaseCurrency", "Currency", { className: "uppercase" })}
          {text(f, "purchaseCost", "Cost", { inputMode: "decimal", className: "tabular" })}
        </div>
      </fieldset>
      <Field label="Notes" errors={f.errors("notes")}>
        {(p) => <Textarea name="notes" rows={2} defaultValue={f.value("notes")} {...p} />}
      </Field>
      <Submit pending={f.pending} label={submitLabel} primary />
    </form>
  );
}

export function CategoryForm({
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
      <FormAlert {...f} title="The category wasn't saved" />
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        {text(f, "name", "Name", { required: true })}
        {text(f, "inspectionIntervalDays", "Inspect every (days)", {
          inputMode: "numeric",
          className: "tabular",
          description: "Blank if not inspected on a schedule",
        })}
      </div>
      {text(f, "description", "Description")}
      <Field
        label="Inspection checklist"
        description="One check per line"
        errors={f.errors("inspectionChecklist")}
      >
        {(p) => (
          <Textarea
            name="inspectionChecklist"
            rows={3}
            defaultValue={f.value("inspectionChecklist")}
            {...p}
          />
        )}
      </Field>
      <Submit pending={f.pending} label={submitLabel} />
    </form>
  );
}

/** Adds or removes stock at a location, with the reason. */
export function AdjustStockForm({ action, locations }: { action: Action; locations: Option[] }) {
  const f = useForm(action, { direction: "ADDED" });
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The stock wasn't changed" />
      <div className="grid gap-3 sm:grid-cols-[1fr_2fr_1fr_3fr]">
        {select(f, "direction", "Change", [
          { id: "ADDED", label: "Add" },
          { id: "REMOVED", label: "Remove" },
        ])}
        {select(f, "locationId", "Location", locations, { required: true, blank: "Choose…" })}
        {text(f, "quantity", "Quantity", {
          required: true,
          inputMode: "numeric",
          className: "tabular",
        })}
        {text(f, "reason", "Reason", { required: true, description: "e.g. bought, count, sold" })}
      </div>
      <Submit pending={f.pending} label="Update stock" />
    </form>
  );
}

export function TransferStockForm({ action, locations }: { action: Action; locations: Option[] }) {
  const f = useForm(action);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="Nothing was moved" />
      <div className="grid gap-3 sm:grid-cols-[2fr_2fr_1fr_3fr]">
        {select(f, "fromLocationId", "From", locations, { required: true, blank: "Choose…" })}
        {select(f, "toLocationId", "To", locations, { required: true, blank: "Choose…" })}
        {text(f, "quantity", "Quantity", {
          required: true,
          inputMode: "numeric",
          className: "tabular",
        })}
        {text(f, "reason", "Reason", { required: true })}
      </div>
      <Submit pending={f.pending} label="Move stock" />
    </form>
  );
}

/** Opens a maintenance job, fault, repair or inspection. */
export function JobForm({
  action,
  kinds,
  locations,
}: {
  action: Action;
  kinds: Record<string, string>;
  /** For stock of a quantity item: where it is and how many. */
  locations?: Option[];
}) {
  const f = useForm(action, { kind: "FAULT", takesOutOfService: "on", quantity: "1" });
  const [kind, setKind] = useState(f.value("kind"));
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The job wasn't opened" />
      <div className="grid gap-3 sm:grid-cols-[1fr_3fr]">
        <Field label="Kind" required errors={f.errors("kind")}>
          {(p) => (
            <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} {...p}>
              {Object.entries(kinds).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {text(f, "title", "What", {
          required: true,
          description: kind === "INSPECTION" ? "The category's checks are added" : undefined,
        })}
      </div>
      {locations ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {select(f, "locationId", "Location", locations, { required: true, blank: "Choose…" })}
          {text(f, "quantity", "Quantity", { inputMode: "numeric", className: "tabular" })}
        </div>
      ) : null}
      <Field label="Details" errors={f.errors("details")}>
        {(p) => <Textarea name="details" rows={2} defaultValue={f.value("details")} {...p} />}
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        {text(f, "blockFrom", "Planned downtime from", {
          type: "date",
          description: "It can't be booked over these days",
        })}
        {text(f, "blockTo", "Until", { type: "date" })}
      </div>
      <label className="text-text flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="takesOutOfService"
          defaultChecked={
            (kind === "FAULT" || kind === "REPAIR") && f.value("takesOutOfService") === "on"
          }
          key={kind}
        />
        Take it out of service now
      </label>
      <Submit pending={f.pending} label="Open job" />
    </form>
  );
}

/** Closes a job with what was done, its cost and, for an inspection, each check. */
export function CompleteJobForm({
  action,
  checklist,
  vendors,
  conditions,
  defaults,
}: {
  action: Action;
  checklist: string[];
  vendors: Option[];
  /** Only for an asset: the condition it is in now. */
  conditions?: Record<string, string>;
  defaults: Record<string, string>;
}) {
  const f = useForm(action, defaults);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The job wasn't closed" />
      {checklist.length ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-text mb-1 text-sm font-medium">Checks passed</legend>
          {checklist.map((label) => (
            <label key={label} className="text-text flex items-center gap-2 text-sm">
              <input type="checkbox" name={`check:${label}`} />
              {label}
            </label>
          ))}
        </fieldset>
      ) : null}
      {text(f, "outcome", "What was found or done", { required: true })}
      <div className="grid gap-3 sm:grid-cols-4">
        {text(f, "currency", "Currency", { className: "uppercase" })}
        {text(f, "cost", "Cost", { inputMode: "decimal", className: "tabular" })}
        {select(f, "vendorId", "Done by vendor", vendors, { blank: "In house" })}
        {conditions
          ? select(f, "condition", "Condition now", fromRecord(conditions), { blank: "Unchanged" })
          : null}
      </div>
      <Submit pending={f.pending} label="Mark done" />
    </form>
  );
}

/** A form with one required reason, for cancelling, writing off or recording a loss. */
export function ReasonForm({
  action,
  label,
  submitLabel,
  fields = {},
  choices,
}: {
  action: Action;
  label: string;
  submitLabel: string;
  fields?: Record<string, string>;
  /** Buttons that each send `state` with their value. */
  choices?: { value: string; label: string }[];
}) {
  const f = useForm(action);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-2" noValidate>
      <FormAlert {...f} title="Nothing was changed" />
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Field label={label} required errors={f.errors("reason")}>
        {(p) => <Input name="reason" defaultValue={f.value("reason")} {...p} />}
      </Field>
      <div className="flex flex-wrap gap-2">
        {choices ? (
          choices.map((c) => (
            <Button
              key={c.value}
              type="submit"
              name="state"
              value={c.value}
              size="sm"
              disabled={f.pending}
            >
              {c.label}
            </Button>
          ))
        ) : (
          <Button type="submit" size="sm" disabled={f.pending}>
            {submitLabel}
          </Button>
        )}
      </div>
    </form>
  );
}

/** Approves an asset back into service, confirming its condition. */
export function ReturnToServiceForm({ action }: { action: Action }) {
  const f = useForm(action, { condition: "GOOD" });
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="It wasn't returned to service" />
      <div className="grid gap-3 sm:grid-cols-[1fr_3fr]">
        {select(f, "condition", "Condition", [
          { id: "GOOD", label: "Good" },
          { id: "FAIR", label: "Fair" },
        ])}
        {text(f, "note", "Note")}
      </div>
      <Submit pending={f.pending} label="Return to service" />
    </form>
  );
}

/** A kit's code, name and what it holds, as item and quantity rows. */
export function KitForm({
  action,
  defaults,
  rows,
  items,
  submitLabel,
}: {
  action: Action;
  defaults: Record<string, string>;
  rows: { itemId: string; quantity: string }[];
  items: Option[];
  submitLabel: string;
}) {
  const initial = rows.length ? rows : [{ itemId: "", quantity: "1" }];
  const f = useForm(action, {
    ...defaults,
    ...Object.fromEntries(
      initial.flatMap((r, i) => [
        [`itemId.${i}`, r.itemId],
        [`quantity.${i}`, r.quantity],
      ]),
    ),
  });
  const submitted = Object.keys(f.state.values ?? {}).filter((k) => k.startsWith("itemId.")).length;
  const [count, setCount] = useState(Math.max(initial.length, submitted));
  return (
    <form action={f.action} key={f.formKey} className="flex max-w-3xl flex-col gap-4" noValidate>
      <FormAlert {...f} title="The kit wasn't saved" />
      <div className="grid gap-3 sm:grid-cols-[1fr_3fr]">
        {text(f, "code", "Code", { required: true, className: "uppercase" })}
        {text(f, "name", "Name", { required: true })}
      </div>
      {text(f, "description", "Description")}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-text mb-1 text-sm font-medium">Contents</legend>
        {f.errors("components")?.map((e) => (
          <p key={e} className="text-danger text-sm">
            {e}
          </p>
        ))}
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="grid gap-3 sm:grid-cols-[3fr_1fr]">
            {select(f, `itemId.${i}`, `Item ${i + 1}`, items, { blank: "None" })}
            {text(f, `quantity.${i}`, `Quantity ${i + 1}`, {
              inputMode: "numeric",
              className: "tabular",
            })}
          </div>
        ))}
        <div>
          <Button type="button" size="sm" variant="quiet" onClick={() => setCount((c) => c + 1)}>
            Add another item
          </Button>
        </div>
      </fieldset>
      <Submit pending={f.pending} label={submitLabel} primary />
    </form>
  );
}
