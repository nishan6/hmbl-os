"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import { useUnsavedChangesWarning } from "@/components/ui/use-unsaved-changes";
import type { FormState } from "@/server/http/action-result";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;
type Option = { id: string; label: string };

export type ShipmentProject = {
  id: string;
  label: string;
  currency: string;
  budgetLines: Option[];
  equipment: Option[];
};

const KINDS = {
  EQUIPMENT: "Equipment movement",
  FREIGHT: "Freight",
  LOCAL_TRANSFER: "Vehicle and driver",
};

/**
 * A movement: what moves, who carries it, from where to where and when (local
 * time at the pick-up), and what it costs. Cost and budget line are fixed
 * once it is booked.
 */
export function ShipmentForm({
  action,
  projects,
  vendors,
  defaults,
  booked = false,
  submitLabel,
  cancelHref,
}: {
  action: Action;
  /** One project when editing. */
  projects: ShipmentProject[];
  vendors: Option[];
  defaults: Record<string, string> & { bookingIds?: string };
  booked?: boolean;
  submitLabel: string;
  cancelHref: string;
}) {
  const f = useForm(action, defaults);
  const markDirty = useUnsavedChangesWarning(f.state);
  const [projectId, setProjectId] = useState(f.value("projectId") || projects[0]?.id || "");
  const [kind, setKind] = useState(f.value("kind") || "FREIGHT");
  const project = projects.find((p) => p.id === projectId);
  const chosen = new Set((f.value("bookingIds") || "").split(",").filter(Boolean));
  return (
    <form
      action={f.action}
      key={f.formKey}
      className="flex max-w-3xl flex-col gap-4"
      noValidate
      onChange={markDirty}
    >
      <FormAlert {...f} title="The movement wasn't saved" />
      <datalist id="time-zones">
        {["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "UTC"].map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {projects.length > 1 || !defaults.projectId ? (
          <Field label="Project" required errors={f.errors("projectId")}>
            {(p) => (
              <Select
                name="projectId"
                defaultValue={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                {...p}
              >
                <option value="">Choose…</option>
                {projects.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <input type="hidden" name="projectId" value={projectId} />
        )}
        <Field label="What is moving" required errors={f.errors("kind")}>
          {(p) =>
            booked ? (
              <>
                <input type="hidden" name="kind" value={kind} />
                <Input value={KINDS[kind as keyof typeof KINDS]} disabled {...p} />
              </>
            ) : (
              <Select
                name="kind"
                defaultValue={kind}
                onChange={(e) => setKind(e.target.value)}
                {...p}
              >
                {Object.entries(KINDS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )
          }
        </Field>
        <Field
          label="Title"
          required
          description="E.g. Stage set to the Dome"
          errors={f.errors("title")}
        >
          {(p) => <Input name="title" defaultValue={f.value("title")} {...p} />}
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Vendor" description="Who bills for it" errors={f.errors("vendorId")}>
          {(p) => (
            <Select name="vendorId" defaultValue={f.value("vendorId")} {...p}>
              <option value="">Not a vendor on file</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Carrier" description="When not a vendor on file" errors={f.errors("carrier")}>
          {(p) => <Input name="carrier" defaultValue={f.value("carrier")} {...p} />}
        </Field>
        <Field label="Consignment or tracking number" errors={f.errors("reference")}>
          {(p) => <Input name="reference" defaultValue={f.value("reference")} {...p} />}
        </Field>
        <Field
          label="Vehicle"
          description="E.g. 32 ft container, Innova"
          errors={f.errors("vehicle")}
        >
          {(p) => <Input name="vehicle" defaultValue={f.value("vehicle")} {...p} />}
        </Field>
        <Field label="Registration" errors={f.errors("vehicleRegistration")}>
          {(p) => (
            <Input
              name="vehicleRegistration"
              className="max-w-48"
              defaultValue={f.value("vehicleRegistration")}
              {...p}
            />
          )}
        </Field>
        <Field label="Driver" errors={f.errors("driverName")}>
          {(p) => <Input name="driverName" defaultValue={f.value("driverName")} {...p} />}
        </Field>
        <Field label="Driver's phone" errors={f.errors("driverPhone")}>
          {(p) => (
            <Input name="driverPhone" type="tel" defaultValue={f.value("driverPhone")} {...p} />
          )}
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="From" required errors={f.errors("fromAddress")}>
          {(p) => <Input name="fromAddress" defaultValue={f.value("fromAddress")} {...p} />}
        </Field>
        <Field label="To" required errors={f.errors("toAddress")}>
          {(p) => <Input name="toAddress" defaultValue={f.value("toAddress")} {...p} />}
        </Field>
        <Field label="Pick-up (local time there)" required errors={f.errors("pickupLocal")}>
          {(p) => (
            <Input
              type="datetime-local"
              name="pickupLocal"
              defaultValue={f.value("pickupLocal")}
              {...p}
            />
          )}
        </Field>
        <Field label="Time zone at the pick-up" required errors={f.errors("pickupTimeZone")}>
          {(p) => (
            <Input
              name="pickupTimeZone"
              list="time-zones"
              defaultValue={f.value("pickupTimeZone") || "Asia/Kolkata"}
              {...p}
            />
          )}
        </Field>
        <Field label="Deliver by (local time there)" errors={f.errors("deliverLocal")}>
          {(p) => (
            <Input
              type="datetime-local"
              name="deliverLocal"
              defaultValue={f.value("deliverLocal")}
              {...p}
            />
          )}
        </Field>
        <Field label="Time zone at the delivery" errors={f.errors("deliverTimeZone")}>
          {(p) => (
            <Input
              name="deliverTimeZone"
              list="time-zones"
              defaultValue={f.value("deliverTimeZone") || "Asia/Kolkata"}
              {...p}
            />
          )}
        </Field>
      </div>
      {kind !== "LOCAL_TRANSFER" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Packages" errors={f.errors("packages")}>
            {(p) => (
              <Input
                name="packages"
                inputMode="numeric"
                className="tabular max-w-32"
                defaultValue={f.value("packages")}
                {...p}
              />
            )}
          </Field>
          <Field label="Weight (kg)" errors={f.errors("weightKg")}>
            {(p) => (
              <Input
                name="weightKg"
                inputMode="decimal"
                className="tabular max-w-32"
                defaultValue={f.value("weightKg")}
                {...p}
              />
            )}
          </Field>
        </div>
      ) : null}
      <Field label="Contents or purpose" errors={f.errors("contents")}>
        {(p) => <Textarea name="contents" defaultValue={f.value("contents")} {...p} />}
      </Field>
      {kind === "EQUIPMENT" && project ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-text mb-1 text-sm font-medium">Equipment on board</legend>
          {project.equipment.length ? (
            project.equipment.map((e) => (
              <label key={e.id} className="text-text flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="bookingIds"
                  value={e.id}
                  defaultChecked={chosen.has(e.id)}
                />
                {e.label}
              </label>
            ))
          ) : (
            <p className="text-secondary text-sm">No equipment is reserved for this project.</p>
          )}
          {f.errors("bookingIds") ? (
            <p className="text-danger text-xs">{f.errors("bookingIds")!.join(" ")}</p>
          ) : null}
        </fieldset>
      ) : null}
      {booked ? (
        <p className="text-secondary text-sm">
          The cost and budget line were committed when it was booked. Change the cost with a reason
          on the movement&apos;s page.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label={`Cost${project ? ` (${project.currency})` : ""}`}
            description="Before tax"
            errors={f.errors("cost")}
          >
            {(p) => (
              <Input
                name="cost"
                inputMode="decimal"
                className="tabular max-w-48"
                defaultValue={f.value("cost")}
                {...p}
              />
            )}
          </Field>
          <Field
            label="Paid from budget line"
            description="Needed to book a paid movement"
            errors={f.errors("budgetLineId")}
          >
            {(p) => (
              <Select name="budgetLineId" defaultValue={f.value("budgetLineId")} {...p}>
                <option value="">Choose…</option>
                {(project?.budgetLines ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      )}
      <Field label="Notes" errors={f.errors("notes")}>
        {(p) => <Textarea name="notes" defaultValue={f.value("notes")} {...p} />}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Saving…" : submitLabel}
        </Button>
        <Link href={cancelHref} className={buttonClasses("quiet")}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

/** Two short fields and a button: delivery (received by, note) or a cost change (amount, reason). */
export function PairForm({
  action,
  first,
  second,
  submitLabel,
}: {
  action: Action;
  first: { name: string; label: string; required?: boolean; numeric?: boolean };
  second: { name: string; label: string; required?: boolean };
  submitLabel: string;
}) {
  const f = useForm(action);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-2" noValidate>
      <FormAlert {...f} title="Nothing was changed" />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label={first.label} required={first.required} errors={f.errors(first.name)}>
          {(p) => (
            <Input
              name={first.name}
              inputMode={first.numeric ? "decimal" : undefined}
              className={first.numeric ? "tabular max-w-48" : undefined}
              defaultValue={f.value(first.name)}
              {...p}
            />
          )}
        </Field>
        <Field label={second.label} required={second.required} errors={f.errors(second.name)}>
          {(p) => <Input name={second.name} defaultValue={f.value(second.name)} {...p} />}
        </Field>
      </div>
      <div>
        <Button type="submit" size="sm" disabled={f.pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
