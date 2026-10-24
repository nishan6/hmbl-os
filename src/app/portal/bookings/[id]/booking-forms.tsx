"use client";

import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import { answerBookingAction, timesheetAction } from "../../actions";

export function BookingAnswerForm({ assignmentId }: { assignmentId: string }) {
  const f = useForm(answerBookingAction.bind(null, assignmentId));
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="Your answer wasn't recorded" />
      <Field label="Note" description="Needed if you can't do it." errors={f.errors("note")}>
        {(p) => <Textarea name="note" rows={3} defaultValue={f.value("note")} {...p} />}
      </Field>
      <Button type="submit" name="answer" value="CONFIRMED" variant="primary" disabled={f.pending}>
        Yes, I can do it
      </Button>
      <Button type="submit" name="answer" value="DECLINED" variant="secondary" disabled={f.pending}>
        No, I can&apos;t
      </Button>
    </form>
  );
}

export function TimesheetForm({
  assignmentId,
  currency,
  start,
  end,
}: {
  assignmentId: string;
  currency: string;
  start: string;
  end: string;
}) {
  const f = useForm(timesheetAction.bind(null, assignmentId), { day: "FULL" });
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The day wasn't saved" />
      <Field label="Date" required errors={f.errors("date")}>
        {(p) => (
          <Input
            name="date"
            type="date"
            min={start}
            max={end}
            defaultValue={f.value("date")}
            {...p}
          />
        )}
      </Field>
      <Field label="Day" errors={f.errors("day")}>
        {(p) => (
          <Select name="day" defaultValue={f.value("day")} {...p}>
            <option value="FULL">Full day</option>
            <option value="HALF">Half day</option>
          </Select>
        )}
      </Field>
      <Field label="Overtime hours" errors={f.errors("overtimeMinutes")}>
        {(p) => (
          <Input
            name="overtimeHours"
            inputMode="decimal"
            className="tabular"
            defaultValue={f.value("overtimeHours")}
            {...p}
          />
        )}
      </Field>
      <Field label={`Expenses (${currency})`} errors={f.errors("expenses")}>
        {(p) => (
          <Input
            name="expenses"
            inputMode="decimal"
            className="tabular"
            defaultValue={f.value("expenses")}
            {...p}
          />
        )}
      </Field>
      <Field label="Notes" errors={f.errors("notes")}>
        {(p) => <Textarea name="notes" rows={2} defaultValue={f.value("notes")} {...p} />}
      </Field>
      <Button type="submit" variant="primary" disabled={f.pending}>
        {f.pending ? "Saving…" : "Save day"}
      </Button>
    </form>
  );
}
