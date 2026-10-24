"use client";

import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
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
  options: { required?: boolean; description?: string; type?: string; numeric?: boolean } = {},
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
          inputMode={options.numeric ? "numeric" : undefined}
          className={options.numeric ? "tabular" : undefined}
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

function Submit({ pending, label }: { pending: boolean; label: string }) {
  return (
    <div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : label}
      </Button>
    </div>
  );
}

/** Reserves an item or a kit, usually for one of the equipment plan's needs. */
export function ReserveForm({
  action,
  requirements,
  items,
  kits,
  canOverride,
}: {
  action: Action;
  requirements: Option[];
  items: Option[];
  kits: Option[];
  canOverride: boolean;
}) {
  const f = useForm(action);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="Nothing was reserved" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Equipment" required errors={f.errors("itemId") ?? f.errors("kitId")}>
          {(p) => (
            <Select name="equipment" defaultValue={f.value("equipment")} {...p}>
              <option value="">Choose…</option>
              <optgroup label="Items">
                {items.map((i) => (
                  <option key={i.id} value={`item:${i.id}`}>
                    {i.label}
                  </option>
                ))}
              </optgroup>
              {kits.length ? (
                <optgroup label="Kits">
                  {kits.map((k) => (
                    <option key={k.id} value={`kit:${k.id}`}>
                      {k.label}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
          )}
        </Field>
        {select(f, "requirementId", "For equipment need", requirements, {
          blank: "Not in the plan",
          description: "Dates and quantity come from it",
        })}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {text(f, "quantity", "Quantity", { numeric: true, description: "Of a kit: how many kits" })}
        {text(f, "startDate", "First day", { type: "date" })}
        {text(f, "endDate", "Last day", { type: "date" })}
      </div>
      {canOverride
        ? text(f, "overrideReason", "If not enough is free, why reserve anyway", {
            description: "Such as renting in the rest",
          })
        : null}
      <Submit pending={f.pending} label="Reserve" />
    </form>
  );
}

/** Changes quantity or dates, such as an extension. */
export function ChangeBookingForm({
  action,
  defaults,
  canOverride,
}: {
  action: Action;
  defaults: Record<string, string>;
  canOverride: boolean;
}) {
  const f = useForm(action, defaults);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The booking wasn't changed" />
      <div className="grid gap-3 sm:grid-cols-3">
        {text(f, "quantity", "Quantity", { required: true, numeric: true })}
        {text(f, "startDate", "First day", { required: true, type: "date" })}
        {text(f, "endDate", "Last day", { required: true, type: "date" })}
      </div>
      {text(f, "notes", "Notes")}
      {canOverride ? text(f, "overrideReason", "If not enough is free, why anyway") : null}
      <Submit pending={f.pending} label="Save booking" />
    </form>
  );
}

/** Names assets free over the booking's days. */
export function AllocateForm({ action, assets }: { action: Action; assets: Option[] }) {
  const f = useForm(action);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="No assets were named" />
      <fieldset className="flex flex-col gap-1">
        <legend className="text-text mb-1 text-sm font-medium">Free assets</legend>
        {f.errors("assetIds")?.map((e) => (
          <p key={e} className="text-danger text-sm">
            {e}
          </p>
        ))}
        {assets.map((a) => (
          <label key={a.id} className="text-text flex items-center gap-2 text-sm">
            <input type="checkbox" name={`asset:${a.id}`} />
            {a.label}
          </label>
        ))}
      </fieldset>
      <Submit pending={f.pending} label="Name assets" />
    </form>
  );
}

/** Checks equipment out: named assets, or a quantity from a store. */
export function DispatchForm({
  action,
  allocations,
  locations,
}: {
  action: Action;
  /** Serialised: named assets not yet out. */
  allocations?: Option[];
  /** Quantity: stores with what is in service there. */
  locations?: Option[];
}) {
  const f = useForm(action);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="Nothing was dispatched" />
      {allocations ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-text mb-1 text-sm font-medium">Going out</legend>
          {f.errors("allocationIds")?.map((e) => (
            <p key={e} className="text-danger text-sm">
              {e}
            </p>
          ))}
          {allocations.map((a) => (
            <label key={a.id} className="text-text flex items-center gap-2 text-sm">
              <input type="checkbox" name={`allocation:${a.id}`} defaultChecked />
              {a.label}
            </label>
          ))}
        </fieldset>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {select(f, "locationId", "From", locations ?? [], { required: true, blank: "Choose…" })}
          {text(f, "quantity", "Quantity", { required: true, numeric: true })}
        </div>
      )}
      {text(f, "notes", "Notes", { description: "Vehicle, driver or delivery note" })}
      <Submit pending={f.pending} label="Dispatch" />
    </form>
  );
}

const OUTCOMES = [
  { id: "GOOD", label: "Back, good" },
  { id: "FAIR", label: "Back, fair" },
  { id: "DAMAGED", label: "Back, damaged" },
  { id: "LOST", label: "Lost" },
];

/** Checks equipment back in with its condition. */
export function ReturnForm({
  action,
  out,
  locations,
}: {
  action: Action;
  /** Serialised: assets that are out. */
  out?: Option[];
  locations: Option[];
}) {
  const f = useForm(action);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="Nothing was checked in" />
      {out ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-text mb-1 text-sm font-medium">Coming back</legend>
          {f.errors("assets")?.map((e) => (
            <p key={e} className="text-danger text-sm">
              {e}
            </p>
          ))}
          {out.map((a) => (
            <div key={a.id} className="grid items-center gap-2 sm:grid-cols-[1fr_12rem]">
              <label htmlFor={`outcome-${a.id}`} className="text-text text-sm">
                {a.label}
              </label>
              <Select id={`outcome-${a.id}`} name={`outcome:${a.id}`} defaultValue="">
                <option value="">Still out</option>
                {OUTCOMES.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
          ))}
        </fieldset>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          {text(f, "good", "Back in good order", { numeric: true })}
          {text(f, "damaged", "Back damaged", { numeric: true })}
          {text(f, "lost", "Lost", { numeric: true })}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {select(f, "locationId", "Back to", locations, {
          required: !out,
          blank: out ? "Where it was kept" : "Choose…",
        })}
        {text(f, "notes", "Notes", { description: "Damage seen, missing parts" })}
      </div>
      <Submit pending={f.pending} label="Check in" />
    </form>
  );
}
