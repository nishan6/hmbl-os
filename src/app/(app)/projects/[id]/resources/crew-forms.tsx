"use client";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;
type Option = { id: string; label: string };

function text(
  f: ReturnType<typeof useForm>,
  name: string,
  label: string,
  options: { required?: boolean; description?: string; type?: string; className?: string } = {},
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
          className={options.className}
          defaultValue={f.value(name)}
          {...p}
        />
      )}
    </Field>
  );
}

/** Proposes a named person, for a crew role of the plan or on their own. */
export function BookingForm({
  action,
  requirements,
  crew,
  showCosts,
}: {
  action: Action;
  requirements: Option[];
  crew: Option[];
  showCosts: boolean;
}) {
  const f = useForm(action);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="Nobody was booked" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Crew member" required errors={f.errors("crewMemberId")}>
          {(p) => (
            <Select name="crewMemberId" defaultValue={f.value("crewMemberId")} {...p}>
              <option value="">Choose…</option>
              {crew.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="For crew role"
          description="Dates, role and budget line come from it"
          errors={f.errors("requirementId")}
        >
          {(p) => (
            <Select name="requirementId" defaultValue={f.value("requirementId")} {...p}>
              <option value="">Not in the plan</option>
              {requirements.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {text(f, "role", "Booked as", { description: "Blank for the plan's role" })}
        {text(f, "startDate", "First day", { type: "date", description: "Blank for the plan's" })}
        {text(f, "endDate", "Last day", { type: "date" })}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {text(f, "callTime", "Call time", { description: "e.g. 07:00 at venue" })}
        {text(f, "reportTo", "Report to")}
        {showCosts
          ? text(f, "dayRate", "Day rate", {
              description: "Blank for their rate card",
              className: "tabular",
            })
          : null}
      </div>
      <div>
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Booking…" : "Propose"}
        </Button>
      </div>
    </form>
  );
}

/** Confirms a proposed booking; over a clash, with the reason for overriding it. */
export function ConfirmForm({
  action,
  assignmentId,
  clash,
  canOverride,
}: {
  action: Action;
  assignmentId: string;
  clash: boolean;
  canOverride: boolean;
}) {
  const f = useForm(action);
  if (clash && !canOverride) {
    return (
      <p className="text-secondary text-xs">
        Clashes. A crew coordinator or the Director can confirm it anyway.
      </p>
    );
  }
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-2" noValidate>
      <FormAlert {...f} title="It wasn't confirmed" />
      <input type="hidden" name="assignmentId" value={assignmentId} />
      {clash ? (
        <Field label="Why confirm over the clash" required errors={f.errors("overrideReason")}>
          {(p) => <Input name="overrideReason" defaultValue={f.value("overrideReason")} {...p} />}
        </Field>
      ) : null}
      <div>
        <Button type="submit" size="sm" disabled={f.pending}>
          {clash ? "Confirm anyway" : "Confirm"}
        </Button>
      </div>
    </form>
  );
}

/** Ends a booking: they declined, or HMBL cancelled it. */
export function EndForm({ action, assignmentId }: { action: Action; assignmentId: string }) {
  const f = useForm(action);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-2" noValidate>
      <FormAlert {...f} title="The booking wasn't ended" />
      <input type="hidden" name="assignmentId" value={assignmentId} />
      <Field label="Reason" required errors={f.errors("reason")}>
        {(p) => <Input name="reason" defaultValue={f.value("reason")} {...p} />}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" name="to" value="DECLINED" size="sm" disabled={f.pending}>
          They declined
        </Button>
        <Button type="submit" name="to" value="CANCELLED" size="sm" disabled={f.pending}>
          Cancel booking
        </Button>
      </div>
    </form>
  );
}

export function SubstituteForm({ action, crew }: { action: Action; crew: Option[] }) {
  const f = useForm(action);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="Nobody was put in their place" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Replace with" required errors={f.errors("crewMemberId")}>
          {(p) => (
            <Select name="crewMemberId" defaultValue={f.value("crewMemberId")} {...p}>
              <option value="">Choose…</option>
              {crew.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {text(f, "reason", "Reason", { required: true })}
      </div>
      <div>
        <Button type="submit" size="sm" disabled={f.pending}>
          Replace
        </Button>
      </div>
    </form>
  );
}

/** Role, dates, rate and call details of a live booking. */
export function BookingEditForm({
  action,
  defaults,
  showCosts,
  confirmed,
}: {
  action: Action;
  defaults: Record<string, string>;
  showCosts: boolean;
  confirmed: boolean;
}) {
  const f = useForm(action, defaults);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The booking wasn't saved" />
      <div className="grid gap-3 sm:grid-cols-3">
        {text(f, "role", "Booked as", { required: true })}
        {text(f, "startDate", "First day", { required: true, type: "date" })}
        {text(f, "endDate", "Last day", { type: "date" })}
        {text(f, "callTime", "Call time")}
        {text(f, "reportTo", "Report to")}
        {showCosts ? text(f, "dayRate", "Day rate", { className: "tabular" }) : null}
      </div>
      <Field label="Notes" errors={f.errors("notes")}>
        {(p) => <Textarea name="notes" rows={2} defaultValue={f.value("notes")} {...p} />}
      </Field>
      {confirmed ? (
        <Field
          label="Reason, if the new dates clash"
          description="Only someone who can approve crew clashes can confirm over one"
          errors={f.errors("overrideReason")}
        >
          {(p) => <Input name="overrideReason" defaultValue={f.value("overrideReason")} {...p} />}
        </Field>
      ) : null}
      <div>
        <Button type="submit" disabled={f.pending}>
          {f.pending ? "Saving…" : "Save booking"}
        </Button>
      </div>
    </form>
  );
}

/** A day worked: full or half, overtime and money spent. */
export function WorkForm({
  action,
  defaults,
}: {
  action: Action;
  defaults: Record<string, string>;
}) {
  const f = useForm(action, defaults);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The day wasn't recorded" />
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_1fr_2fr]">
        {text(f, "date", "Day", { required: true, type: "date" })}
        <Field label="Worked" errors={f.errors("day")}>
          {(p) => (
            <Select name="day" defaultValue={f.value("day") || "FULL"} {...p}>
              <option value="FULL">Full day</option>
              <option value="HALF">Half day</option>
            </Select>
          )}
        </Field>
        {text(f, "overtime", "Overtime (hours)", {
          description: "e.g. 2.5 or 2:30",
          className: "tabular",
        })}
        {text(f, "expenses", "Expenses", { className: "tabular" })}
        {text(f, "notes", "Notes")}
      </div>
      <div>
        <Button type="submit" disabled={f.pending}>
          {f.pending ? "Saving…" : "Record day"}
        </Button>
      </div>
    </form>
  );
}
