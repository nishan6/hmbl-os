"use client";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** A running-order entry: day, time, what happens and who runs it. */
export function RunOfShowForm({
  action,
  days,
  defaults = {},
  submitLabel,
}: {
  action: Action;
  /** The show's days, as yyyy-mm-dd with a label. */
  days: { value: string; label: string }[];
  defaults?: Record<string, string>;
  submitLabel: string;
}) {
  const f = useForm(action, defaults);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The entry wasn't saved" />
      {defaults.id ? <input type="hidden" name="id" value={defaults.id} /> : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Day" required errors={f.errors("day")}>
          {(p) =>
            days.length ? (
              <Select name="day" defaultValue={f.value("day")} {...p}>
                {days.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </Select>
            ) : (
              <Input type="date" name="day" defaultValue={f.value("day")} {...p} />
            )
          }
        </Field>
        <Field label="Time" required description="Venue time" errors={f.errors("startTime")}>
          {(p) => (
            <Input
              name="startTime"
              inputMode="numeric"
              placeholder="19:30"
              className="tabular"
              defaultValue={f.value("startTime")}
              {...p}
            />
          )}
        </Field>
        <Field label="Minutes" errors={f.errors("durationMinutes")}>
          {(p) => (
            <Input
              name="durationMinutes"
              inputMode="numeric"
              className="tabular"
              defaultValue={f.value("durationMinutes")}
              {...p}
            />
          )}
        </Field>
        <Field label="Who runs it" errors={f.errors("owner")}>
          {(p) => <Input name="owner" defaultValue={f.value("owner")} {...p} />}
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="What happens" required errors={f.errors("title")}>
          {(p) => <Input name="title" defaultValue={f.value("title")} {...p} />}
        </Field>
        <Field label="Where" errors={f.errors("location")}>
          {(p) => <Input name="location" defaultValue={f.value("location")} {...p} />}
        </Field>
      </div>
      <Field label="Notes" errors={f.errors("notes")}>
        {(p) => <Textarea name="notes" rows={2} defaultValue={f.value("notes")} {...p} />}
      </Field>
      <div>
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

const UPDATE_OPTIONS = {
  ON_TRACK: "On track",
  DELAYED: "Delayed",
  ISSUE: "Issue",
  DONE: "Done for the day",
  INFO: "Information",
};

/** What is happening now, posted from the venue. */
export function StatusUpdateForm({ action }: { action: Action }) {
  const f = useForm(action, { status: "ON_TRACK" });
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The update wasn't posted" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[12rem_1fr]">
        <Field label="Status" required errors={f.errors("status")}>
          {(p) => (
            <Select name="status" defaultValue={f.value("status")} {...p}>
              {Object.entries(UPDATE_OPTIONS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Update" required errors={f.errors("message")}>
          {(p) => (
            <Input
              name="message"
              placeholder="Doors open, on schedule"
              defaultValue={f.value("message")}
              {...p}
            />
          )}
        </Field>
      </div>
      <div>
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Posting…" : "Post update"}
        </Button>
      </div>
    </form>
  );
}

/** A production note; pinning is offered to people who plan the show. */
export function NoteForm({
  action,
  canPin,
  defaults = {},
  submitLabel,
}: {
  action: Action;
  canPin: boolean;
  defaults?: Record<string, string>;
  submitLabel: string;
}) {
  const f = useForm(action, defaults);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The note wasn't saved" />
      <Field label="Note" required errors={f.errors("body")}>
        {(p) => (
          <Textarea
            name="body"
            rows={3}
            placeholder="Loading dock closes at 18:00; use gate 3 after that."
            defaultValue={f.value("body")}
            {...p}
          />
        )}
      </Field>
      {canPin ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="pinned" defaultChecked={f.value("pinned") === "on"} />
          Pin to the top
        </label>
      ) : null}
      <div>
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** Publishes the day's call sheet, with general call information. */
export function PublishCallSheetForm({
  action,
  day,
  notes,
  label,
}: {
  action: Action;
  day: string;
  notes?: string;
  label: string;
}) {
  const f = useForm(action, { notes: notes ?? "" });
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The call sheet wasn't published" />
      <input type="hidden" name="day" value={day} />
      <Field
        label="General call information"
        description="Parking, catering, safety briefing. Shown at the top of the sheet."
        errors={f.errors("notes")}
      >
        {(p) => <Textarea name="notes" rows={2} defaultValue={f.value("notes")} {...p} />}
      </Field>
      <div>
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Publishing…" : label}
        </Button>
      </div>
    </form>
  );
}

/** A new checklist from a template, typed items, or both. */
export function ChecklistForm({
  action,
  days,
  templates,
}: {
  action: Action;
  days: { value: string; label: string }[];
  templates: { value: string; label: string }[];
}) {
  const f = useForm(action);
  return (
    <form action={f.action} key={f.formKey} className="flex max-w-xl flex-col gap-3" noValidate>
      <FormAlert {...f} title="The checklist wasn't created" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Title" required errors={f.errors("title")}>
          {(p) => (
            <Input
              name="title"
              placeholder="Load-in safety"
              defaultValue={f.value("title")}
              {...p}
            />
          )}
        </Field>
        <Field label="Day" description="Leave blank for the whole show" errors={f.errors("day")}>
          {(p) => (
            <Select name="day" defaultValue={f.value("day")} {...p}>
              <option value="">Whole show</option>
              {days.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Start from" errors={f.errors("template")}>
        {(p) => (
          <Select name="template" defaultValue={f.value("template")} {...p}>
            <option value="">Nothing, I&apos;ll type the items</option>
            {templates.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label="Items"
        description="One per line, added after the template's"
        errors={f.errors("items")}
      >
        {(p) => <Textarea name="items" rows={4} defaultValue={f.value("items")} {...p} />}
      </Field>
      <div>
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Creating…" : "Create checklist"}
        </Button>
      </div>
    </form>
  );
}

/** Relabel, reorder (by editing), remove (by clearing) and add items. */
export function ChecklistItemsForm({
  action,
  items,
}: {
  action: Action;
  items: { id: string; label: string }[];
}) {
  const f = useForm(action);
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-2" noValidate>
      <FormAlert {...f} title="The checklist wasn't saved" />
      {items.map((item, i) => (
        <div key={item.id}>
          <input type="hidden" name="itemId" value={item.id} />
          <label className="sr-only" htmlFor={`label-${item.id}`}>
            Item {i + 1}
          </label>
          <Input id={`label-${item.id}`} name="label" defaultValue={item.label} />
        </div>
      ))}
      <p className="text-secondary text-xs">
        Clear an item to remove it. Ticks stay on items you keep.
      </p>
      <Field label="Add items" description="One per line" errors={f.errors("items")}>
        {(p) => <Textarea name="add" rows={2} {...p} />}
      </Field>
      <div>
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Saving…" : "Save items"}
        </Button>
      </div>
    </form>
  );
}

const CATEGORY_OPTIONS = {
  SAFETY: "Safety",
  INJURY: "Injury or illness",
  TECHNICAL: "Technical",
  EQUIPMENT: "Equipment",
  CREW: "Crew",
  VENUE: "Venue",
  SECURITY: "Security",
  OTHER: "Other",
};
const SEVERITY_OPTIONS = { LOW: "Low", MEDIUM: "Medium", HIGH: "High", CRITICAL: "Critical" };

/** What happened, when, how serious, and what was done. Times are venue time. */
export function IncidentForm({
  action,
  timeZone,
  defaults = {},
  submitLabel,
}: {
  action: Action;
  timeZone: string;
  defaults?: Record<string, string>;
  submitLabel: string;
}) {
  const f = useForm(action, { severity: "MEDIUM", ...defaults });
  return (
    <form action={f.action} key={f.formKey} className="flex max-w-2xl flex-col gap-3" noValidate>
      <FormAlert {...f} title="The incident wasn't saved" />
      <input type="hidden" name="timeZone" value={timeZone} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="When" required description={timeZone} errors={f.errors("occurredAt")}>
          {(p) => (
            <Input
              type="datetime-local"
              name="occurredLocal"
              defaultValue={f.value("occurredLocal")}
              {...p}
            />
          )}
        </Field>
        <Field label="Kind" required errors={f.errors("category")}>
          {(p) => (
            <Select name="category" defaultValue={f.value("category")} {...p}>
              <option value="">Choose…</option>
              {Object.entries(CATEGORY_OPTIONS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Severity" required errors={f.errors("severity")}>
          {(p) => (
            <Select name="severity" defaultValue={f.value("severity")} {...p}>
              {Object.entries(SEVERITY_OPTIONS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Title" required errors={f.errors("title")}>
          {(p) => (
            <Input
              name="title"
              placeholder="Truss motor tripped"
              defaultValue={f.value("title")}
              {...p}
            />
          )}
        </Field>
        <Field label="Where" errors={f.errors("location")}>
          {(p) => <Input name="location" defaultValue={f.value("location")} {...p} />}
        </Field>
      </div>
      <Field label="What happened" required errors={f.errors("description")}>
        {(p) => (
          <Textarea name="description" rows={3} defaultValue={f.value("description")} {...p} />
        )}
      </Field>
      <Field
        label="Who was involved"
        description="Only planners and you will see this"
        errors={f.errors("peopleInvolved")}
      >
        {(p) => (
          <Textarea
            name="peopleInvolved"
            rows={2}
            defaultValue={f.value("peopleInvolved")}
            {...p}
          />
        )}
      </Field>
      <Field label="What was done" errors={f.errors("actionTaken")}>
        {(p) => (
          <Textarea name="actionTaken" rows={2} defaultValue={f.value("actionTaken")} {...p} />
        )}
      </Field>
      <div>
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function ResolveIncidentForm({ action }: { action: Action }) {
  const f = useForm(action);
  return (
    <form action={f.action} key={f.formKey} className="flex max-w-xl flex-col gap-3" noValidate>
      <FormAlert {...f} title="The incident wasn't resolved" />
      <Field label="Resolution" required errors={f.errors("resolution")}>
        {(p) => <Textarea name="resolution" rows={2} defaultValue={f.value("resolution")} {...p} />}
      </Field>
      <div>
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Resolving…" : "Resolve"}
        </Button>
      </div>
    </form>
  );
}
