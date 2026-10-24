"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import { useUnsavedChangesWarning } from "@/components/ui/use-unsaved-changes";
import type { FormState } from "@/server/http/action-result";
import { isJourney, type TravelBookingKind } from "@/lib/travel";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;
type Option = { id: string; label: string };

/** Zones offered first; any IANA zone can be typed. */
const COMMON_ZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Bangkok",
  "Asia/Kathmandu",
  "Asia/Dhaka",
  "Asia/Colombo",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "UTC",
];

export type ProjectOption = {
  id: string;
  label: string;
  budgetLines: Option[];
};

/** A trip's dates, route, estimate and the budget line that pays for it. */
export function TripForm({
  action,
  projects,
  budgetLines,
  defaults,
  estimateLocked = false,
  currency,
  submitLabel,
  cancelHref,
}: {
  action: Action;
  /** Given when starting a trip: the project is chosen here. */
  projects?: ProjectOption[];
  /** Given when editing: the project's lines. */
  budgetLines?: Option[];
  defaults: Record<string, string>;
  /** After approval the estimate and budget line are what was approved. */
  estimateLocked?: boolean;
  currency?: string;
  submitLabel: string;
  cancelHref: string;
}) {
  const f = useForm(action, defaults);
  const [projectId, setProjectId] = useState(f.value("projectId"));
  const lines = projects
    ? (projects.find((p) => p.id === projectId)?.budgetLines ?? [])
    : (budgetLines ?? []);
  const markDirty = useUnsavedChangesWarning(f.state);
  return (
    <form
      action={f.action}
      key={f.formKey}
      className="flex max-w-xl flex-col gap-4"
      noValidate
      onChange={markDirty}
    >
      <FormAlert {...f} title="The trip wasn't saved" />
      {projects ? (
        <Field label="Project" required errors={f.errors("projectId")}>
          {(p) => (
            <Select
              name="projectId"
              defaultValue={f.value("projectId")}
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
      ) : null}
      <Field
        label="Purpose"
        required
        description="E.g. Crew to Mumbai for the awards"
        errors={f.errors("title")}
      >
        {(p) => <Input name="title" defaultValue={f.value("title")} {...p} />}
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="First day" required errors={f.errors("startDate")}>
          {(p) => <Input type="date" name="startDate" defaultValue={f.value("startDate")} {...p} />}
        </Field>
        <Field label="Last day" errors={f.errors("endDate")}>
          {(p) => <Input type="date" name="endDate" defaultValue={f.value("endDate")} {...p} />}
        </Field>
      </div>
      <Field
        label="Route"
        description="E.g. Guwahati → Mumbai → Guwahati"
        errors={f.errors("route")}
      >
        {(p) => <Input name="route" defaultValue={f.value("route")} {...p} />}
      </Field>
      {estimateLocked ? (
        <p className="text-secondary text-sm">
          The estimate and budget line were approved and can no longer change.
        </p>
      ) : (
        <>
          <Field
            label={`Estimate${currency ? ` (${currency})` : ""}`}
            description="The travel budget for this trip, before tax"
            errors={f.errors("estimate")}
          >
            {(p) => (
              <Input
                name="estimate"
                inputMode="decimal"
                className="tabular max-w-48"
                defaultValue={f.value("estimate")}
                {...p}
              />
            )}
          </Field>
          <Field
            label="Paid from budget line"
            description="Needed before the trip is submitted"
            errors={f.errors("budgetLineId")}
          >
            {(p) => (
              <Select name="budgetLineId" defaultValue={f.value("budgetLineId")} {...p}>
                <option value="">Choose…</option>
                {lines.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </>
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

const DOCUMENT_TYPE_OPTIONS = {
  PASSPORT: "Passport",
  NATIONAL_ID: "National ID card",
  DRIVING_LICENCE: "Driving licence",
  OTHER: "Other",
};

/**
 * A traveller: crew from their record, or a guest by name. Identity document
 * fields show only to people with sensitive travel access.
 */
export function TravellerForm({
  action,
  crew,
  sensitive,
  defaults = {},
  editing = false,
  submitLabel,
  cancelHref,
}: {
  action: Action;
  crew?: Option[];
  sensitive: boolean;
  defaults?: Record<string, string>;
  editing?: boolean;
  submitLabel: string;
  cancelHref?: string;
}) {
  const f = useForm(action, defaults);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The traveller wasn't saved" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {crew && !editing ? (
          <Field label="Crew member" errors={f.errors("crewMemberId")}>
            {(p) => (
              <Select name="crewMemberId" defaultValue={f.value("crewMemberId")} {...p}>
                <option value="">A guest, not crew</option>
                {crew.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        <Field
          label="Name"
          description={editing ? undefined : "For a guest; crew come from their record"}
          errors={f.errors("name")}
        >
          {(p) => <Input name="name" defaultValue={f.value("name")} {...p} />}
        </Field>
        <Field label="Phone" errors={f.errors("phone")}>
          {(p) => <Input name="phone" type="tel" defaultValue={f.value("phone")} {...p} />}
        </Field>
        <Field label="Email" errors={f.errors("email")}>
          {(p) => <Input name="email" type="email" defaultValue={f.value("email")} {...p} />}
        </Field>
        <Field
          label="Preferences"
          description="Seat, meal, other needs"
          errors={f.errors("preferences")}
        >
          {(p) => <Input name="preferences" defaultValue={f.value("preferences")} {...p} />}
        </Field>
      </div>
      {sensitive ? (
        <fieldset className="border-separator grid grid-cols-1 gap-3 rounded-md border p-3 sm:grid-cols-2">
          <legend className="text-text px-1 text-sm font-medium">
            Identity documents (sensitive)
          </legend>
          <Field label="Document" errors={f.errors("documentType")}>
            {(p) => (
              <Select name="documentType" defaultValue={f.value("documentType")} {...p}>
                <option value="">None</option>
                {Object.entries(DOCUMENT_TYPE_OPTIONS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Document number" errors={f.errors("documentNumber")}>
            {(p) => (
              <Input
                name="documentNumber"
                autoComplete="off"
                defaultValue={f.value("documentNumber")}
                {...p}
              />
            )}
          </Field>
          <Field label="Expires" errors={f.errors("documentExpiry")}>
            {(p) => (
              <Input
                type="date"
                name="documentExpiry"
                defaultValue={f.value("documentExpiry")}
                {...p}
              />
            )}
          </Field>
          <Field
            label="Nationality"
            description="Two-letter country code, e.g. IN"
            errors={f.errors("nationality")}
          >
            {(p) => (
              <Input
                name="nationality"
                maxLength={2}
                className="max-w-20"
                defaultValue={f.value("nationality")}
                {...p}
              />
            )}
          </Field>
          <Field label="Visa reference" errors={f.errors("visaReference")}>
            {(p) => <Input name="visaReference" defaultValue={f.value("visaReference")} {...p} />}
          </Field>
        </fieldset>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="submit"
          variant={editing ? "primary" : "secondary"}
          size={editing ? "md" : "sm"}
          disabled={f.pending}
        >
          {submitLabel}
        </Button>
        {cancelHref ? (
          <Link href={cancelHref} className={buttonClasses("quiet")}>
            Cancel
          </Link>
        ) : null}
      </div>
    </form>
  );
}

/**
 * A flight, train, hotel or transfer. Times are typed as the local time where
 * they happen, with that place's time zone. A change to a confirmed booking
 * also asks for the reason and any change charge.
 */
export function BookingForm({
  action,
  kind,
  vendors,
  travellers,
  defaults,
  change = false,
  currency,
  submitLabel,
  cancelHref,
}: {
  action: Action;
  kind: TravelBookingKind;
  vendors: Option[];
  travellers: Option[];
  defaults: Record<string, string> & { travellerIds?: string };
  change?: boolean;
  currency: string;
  submitLabel: string;
  cancelHref: string;
}) {
  const f = useForm(action, defaults);
  const chosen = new Set((f.value("travellerIds") || "").split(",").filter(Boolean));
  const journey = isJourney(kind);
  const hotel = kind === "HOTEL";
  const markDirty = useUnsavedChangesWarning(f.state);
  return (
    <form
      action={f.action}
      key={f.formKey}
      className="flex max-w-3xl flex-col gap-4"
      noValidate
      onChange={markDirty}
    >
      <FormAlert {...f} title="The booking wasn't saved" />
      <input type="hidden" name="kind" value={kind} />
      <datalist id="time-zones">
        {COMMON_ZONES.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
      {change ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Why it changed" required errors={f.errors("reason")}>
            {(p) => <Input name="reason" defaultValue={f.value("reason")} {...p} />}
          </Field>
          <Field
            label={`Change charge (${currency})`}
            description="Added to the cost below"
            errors={f.errors("fee")}
          >
            {(p) => (
              <Input
                name="fee"
                inputMode="decimal"
                className="tabular max-w-48"
                defaultValue={f.value("fee")}
                {...p}
              />
            )}
          </Field>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label={
            hotel
              ? "Hotel"
              : kind === "FLIGHT"
                ? "Airline"
                : kind === "RAIL"
                  ? "Rail operator"
                  : "Provider"
          }
          errors={f.errors("provider")}
        >
          {(p) => <Input name="provider" defaultValue={f.value("provider")} {...p} />}
        </Field>
        <Field
          label="Booked through vendor"
          description="Who bills for it"
          errors={f.errors("vendorId")}
        >
          {(p) => (
            <Select name="vendorId" defaultValue={f.value("vendorId")} {...p}>
              <option value="">Not through a vendor</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Booking reference"
          description="PNR or confirmation number; needed to confirm"
          errors={f.errors("reference")}
        >
          {(p) => <Input name="reference" defaultValue={f.value("reference")} {...p} />}
        </Field>
        <Field
          label={
            kind === "FLIGHT"
              ? "Flight number"
              : kind === "RAIL"
                ? "Train and class"
                : hotel
                  ? "Room type"
                  : "Vehicle"
          }
          errors={f.errors("serviceDetails")}
        >
          {(p) => <Input name="serviceDetails" defaultValue={f.value("serviceDetails")} {...p} />}
        </Field>
      </div>
      {journey || kind === "OTHER" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="From" required={journey} errors={f.errors("fromPlace")}>
            {(p) => <Input name="fromPlace" defaultValue={f.value("fromPlace")} {...p} />}
          </Field>
          <Field label="To" required={journey} errors={f.errors("toPlace")}>
            {(p) => <Input name="toPlace" defaultValue={f.value("toPlace")} {...p} />}
          </Field>
          <Field
            label="Leaves (local time there)"
            required={journey}
            errors={f.errors("departLocal")}
          >
            {(p) => (
              <Input
                type="datetime-local"
                name="departLocal"
                defaultValue={f.value("departLocal")}
                {...p}
              />
            )}
          </Field>
          <Field label="Time zone where it leaves" errors={f.errors("departTimeZone")}>
            {(p) => (
              <Input
                name="departTimeZone"
                list="time-zones"
                defaultValue={f.value("departTimeZone") || "Asia/Kolkata"}
                {...p}
              />
            )}
          </Field>
          <Field label="Arrives (local time there)" errors={f.errors("arriveLocal")}>
            {(p) => (
              <Input
                type="datetime-local"
                name="arriveLocal"
                defaultValue={f.value("arriveLocal")}
                {...p}
              />
            )}
          </Field>
          <Field label="Time zone where it arrives" errors={f.errors("arriveTimeZone")}>
            {(p) => (
              <Input
                name="arriveTimeZone"
                list="time-zones"
                defaultValue={f.value("arriveTimeZone") || "Asia/Kolkata"}
                {...p}
              />
            )}
          </Field>
        </div>
      ) : null}
      {hotel ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Check in" required errors={f.errors("checkIn")}>
            {(p) => <Input type="date" name="checkIn" defaultValue={f.value("checkIn")} {...p} />}
          </Field>
          <Field label="Check out" required errors={f.errors("checkOut")}>
            {(p) => <Input type="date" name="checkOut" defaultValue={f.value("checkOut")} {...p} />}
          </Field>
          <Field label="Rooms" errors={f.errors("rooms")}>
            {(p) => (
              <Input
                name="rooms"
                inputMode="numeric"
                className="tabular max-w-24"
                defaultValue={f.value("rooms")}
                {...p}
              />
            )}
          </Field>
        </div>
      ) : null}
      {hotel || kind === "GROUND" ? (
        <Field label={hotel ? "Address" : "Pick-up address"} errors={f.errors("address")}>
          {(p) => <Input name="address" defaultValue={f.value("address")} {...p} />}
        </Field>
      ) : null}
      {kind === "GROUND" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Driver" errors={f.errors("driverName")}>
            {(p) => <Input name="driverName" defaultValue={f.value("driverName")} {...p} />}
          </Field>
          <Field label="Driver's phone" errors={f.errors("driverPhone")}>
            {(p) => (
              <Input name="driverPhone" type="tel" defaultValue={f.value("driverPhone")} {...p} />
            )}
          </Field>
        </div>
      ) : null}
      <Field
        label={`Cost (${currency})`}
        description={
          change ? "The new fare or rate, before the change charge and tax" : "Before tax"
        }
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
      <fieldset className="flex flex-col gap-1">
        <legend className="text-text mb-1 text-sm font-medium">For</legend>
        {travellers.length ? (
          travellers.map((t) => (
            <label key={t.id} className="text-text flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="travellerIds"
                value={t.id}
                defaultChecked={chosen.has(t.id)}
              />
              {t.label}
            </label>
          ))
        ) : (
          <p className="text-secondary text-sm">Add travellers to the trip first.</p>
        )}
        {f.errors("travellerIds") ? (
          <p className="text-danger text-xs">{f.errors("travellerIds")!.join(" ")}</p>
        ) : null}
      </fieldset>
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

/** A reason, and optionally a charge: sending a trip back, cancelling it or a booking. */
export function ReasonForm({
  action,
  label,
  submitLabel,
  feeLabel,
  confirm,
  variant,
}: {
  action: Action;
  label: string;
  submitLabel: string;
  /** Asks for a charge too, e.g. the cancellation charge. */
  feeLabel?: string;
  confirm?: string;
  variant?: "destructive";
}) {
  const f = useForm(action);
  return (
    <form
      action={f.action}
      key={f.formKey}
      className="flex flex-col gap-2"
      noValidate
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      <FormAlert {...f} title="Nothing was changed" />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field label={label} required errors={f.errors("reason")}>
          {(p) => <Input name="reason" defaultValue={f.value("reason")} {...p} />}
        </Field>
        {feeLabel ? (
          <Field label={feeLabel} errors={f.errors("fee")}>
            {(p) => (
              <Input
                name="fee"
                inputMode="decimal"
                className="tabular max-w-48"
                defaultValue={f.value("fee")}
                {...p}
              />
            )}
          </Field>
        ) : null}
      </div>
      <div>
        <Button type="submit" size="sm" variant={variant} disabled={f.pending}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** Which room each guest of a hotel booking is in. */
export function RoomsForm({
  action,
  guests,
}: {
  action: Action;
  guests: { travellerId: string; name: string; room: string | null }[];
}) {
  const f = useForm(action);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-2" noValidate>
      <FormAlert {...f} title="The rooms weren't saved" />
      {f.errors("rooms") ? (
        <p className="text-danger text-xs">{f.errors("rooms")!.join(" ")}</p>
      ) : null}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {guests.map((g) => (
          <Field key={g.travellerId} label={`${g.name}'s room`}>
            {(p) => (
              <Input
                name={`room:${g.travellerId}`}
                className="max-w-32"
                defaultValue={f.value(`room:${g.travellerId}`) || (g.room ?? "")}
                {...p}
              />
            )}
          </Field>
        ))}
      </div>
      <div>
        <Button type="submit" size="sm" disabled={f.pending}>
          Save rooms
        </Button>
      </div>
    </form>
  );
}
