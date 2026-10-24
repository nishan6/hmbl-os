"use client";

import { useState } from "react";
import type { ShowUpdateStatus } from "@/generated/prisma/enums";
import { formatDateTime } from "@/lib/format";
import { zonedToUtc } from "@/lib/time-zone";
import { INCIDENT_CATEGORIES, INCIDENT_SEVERITIES, SHOW_UPDATE_STATUSES } from "@/lib/production";
import {
  OPERATION_LABELS,
  type OperationKind,
  type OperationPayloads,
  type QueuedOperation,
} from "@/lib/offline/operations";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";

export type Queue = <K extends OperationKind>(
  kind: K,
  payload: OperationPayloads[K],
  label: string,
) => Promise<void>;

export type Resolve = (op: QueuedOperation, action: "discard" | "again") => Promise<void>;

const STATE: Record<QueuedOperation["state"], "pending_sync" | "conflict" | "rejected"> = {
  pending: "pending_sync",
  conflict: "conflict",
  rejected: "rejected",
};

/** Changes made on this device that the server hasn't accepted yet. */
export function PendingChanges({
  queue,
  timeZone,
  online,
  onResolve,
}: {
  queue: QueuedOperation[];
  timeZone: string;
  online: boolean;
  onResolve: Resolve;
}) {
  if (!queue.length) return null;
  return (
    <Section
      title="Changes not sent"
      description={
        online
          ? "Sending to HMBL OS. Anything it couldn't accept waits here for you."
          : "Saved on this device. They are sent when you're back online."
      }
    >
      <ul className="divide-separator border-separator divide-y rounded-lg border">
        {queue.map((op) => (
          <li key={op.id} className="flex flex-wrap items-start gap-2 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  status={STATE[op.state]}
                  label={
                    op.state === "rejected"
                      ? "Not accepted"
                      : op.state === "pending"
                        ? op.attempts
                          ? "Retrying"
                          : "Not sent"
                        : undefined
                  }
                />
                <span className="text-text">
                  {OPERATION_LABELS[op.kind]}: {op.label}
                </span>
              </p>
              <p className="text-muted tabular text-xs">
                Made {formatDateTime(op.queuedAt, timeZone)}
                {op.state === "pending" && op.retryAt
                  ? ` · tried ${op.attempts} ${op.attempts === 1 ? "time" : "times"}`
                  : ""}
              </p>
              {op.state === "conflict" && op.current ? (
                <p className="text-text mt-1 text-sm">
                  {op.current.done ? "Ticked" : "Unticked"} by {op.current.doneBy ?? "someone else"}
                  {op.current.doneAt
                    ? ` at ${formatDateTime(op.current.doneAt, timeZone)}`
                    : ""}{" "}
                  before your change arrived. Nothing was changed.
                </p>
              ) : null}
              {op.state === "rejected" && op.error ? (
                <p className="text-danger mt-1 text-sm">{op.error}</p>
              ) : null}
            </div>
            {op.state !== "pending" ? (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void onResolve(op, "again")}>
                  {op.state === "conflict" ? "Use mine" : "Try again"}
                </Button>
                <Button size="sm" variant="quiet" onClick={() => void onResolve(op, "discard")}>
                  {op.state === "conflict" ? "Keep theirs" : "Discard"}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Form({
  title,
  onSubmit,
  children,
}: {
  title: string;
  onSubmit: (data: FormData) => Promise<string | null>;
  children: React.ReactNode;
}) {
  const [message, setMessage] = useState<string | null>(null);
  return (
    <form
      aria-label={title}
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const error = await onSubmit(new FormData(form));
        if (error) setMessage(error);
        else {
          form.reset();
          setMessage(null);
        }
      }}
    >
      {children}
      {message ? (
        <p role="alert" className="text-danger text-sm">
          {message}
        </p>
      ) : null}
    </form>
  );
}

const text = (data: FormData, name: string) => String(data.get(name) ?? "").trim();

/** Status updates, notes and incident reports; each works offline and is sent later. */
export function OfflineForms({ timeZone, onQueue }: { timeZone: string; onQueue: Queue }) {
  const [open, setOpen] = useState<"status" | "note" | "incident" | null>(null);
  const toggle = (which: typeof open) => setOpen((v) => (v === which ? null : which));
  return (
    <Section
      title="Post from the venue"
      description="Works offline: what you post is sent when you're connected."
    >
      <div className="mb-3 flex flex-wrap gap-2">
        <Button size="sm" aria-expanded={open === "status"} onClick={() => toggle("status")}>
          Status update
        </Button>
        <Button size="sm" aria-expanded={open === "note"} onClick={() => toggle("note")}>
          Note
        </Button>
        <Button size="sm" aria-expanded={open === "incident"} onClick={() => toggle("incident")}>
          Report an incident
        </Button>
      </div>

      {open === "status" ? (
        <Form
          title="Status update"
          onSubmit={async (data) => {
            const message = text(data, "message");
            if (!message) return "Say what is happening.";
            const status = text(data, "status") as ShowUpdateStatus;
            await onQueue("status.post", { status, message }, SHOW_UPDATE_STATUSES[status]);
            setOpen(null);
            return null;
          }}
        >
          <Field label="Status" required>
            {(p) => (
              <Select {...p} name="status" defaultValue="ON_TRACK">
                {Object.entries(SHOW_UPDATE_STATUSES).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="What is happening" required>
            {(p) => <Textarea {...p} name="message" maxLength={1000} />}
          </Field>
          <Button type="submit" variant="primary">
            Post update
          </Button>
        </Form>
      ) : null}

      {open === "note" ? (
        <Form
          title="Note"
          onSubmit={async (data) => {
            const body = text(data, "body");
            if (!body) return "Write the note.";
            await onQueue("note.add", { body }, body.length > 60 ? `${body.slice(0, 57)}…` : body);
            setOpen(null);
            return null;
          }}
        >
          <Field label="Note" required>
            {(p) => <Textarea {...p} name="body" maxLength={4000} />}
          </Field>
          <Button type="submit" variant="primary">
            Add note
          </Button>
        </Form>
      ) : null}

      {open === "incident" ? (
        <Form
          title="Report an incident"
          onSubmit={async (data) => {
            const title = text(data, "title");
            const description = text(data, "description");
            const occurred = zonedToUtc(text(data, "occurredAt"), timeZone);
            if (!title || !description || !occurred) {
              return "Fill in when it happened, what happened and a short title.";
            }
            if (occurred.getTime() > Date.now() + 5 * 60_000)
              return "It can't have happened in the future.";
            await onQueue(
              "incident.report",
              {
                occurredAt: occurred.toISOString(),
                category: text(data, "category"),
                severity: text(data, "severity"),
                title,
                description,
                location: text(data, "location") || null,
                peopleInvolved: text(data, "peopleInvolved") || null,
                actionTaken: text(data, "actionTaken") || null,
              },
              title,
            );
            setOpen(null);
            return null;
          }}
        >
          <Field label={`When it happened (${timeZone})`} required>
            {(p) => <Input {...p} type="datetime-local" name="occurredAt" />}
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kind" required>
              {(p) => (
                <Select {...p} name="category" defaultValue="SAFETY">
                  {Object.entries(INCIDENT_CATEGORIES).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="How serious" required>
              {(p) => (
                <Select {...p} name="severity" defaultValue="LOW">
                  {Object.entries(INCIDENT_SEVERITIES).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field label="Short title" required>
            {(p) => <Input {...p} name="title" maxLength={200} />}
          </Field>
          <Field label="What happened" required>
            {(p) => <Textarea {...p} name="description" maxLength={4000} />}
          </Field>
          <Field label="Where">{(p) => <Input {...p} name="location" maxLength={200} />}</Field>
          <Field
            label="Who was involved"
            description="Seen only by you and whoever plans the show. Kept on this device until it is sent."
          >
            {(p) => <Textarea {...p} name="peopleInvolved" maxLength={1000} />}
          </Field>
          <Field label="What was done">
            {(p) => <Textarea {...p} name="actionTaken" maxLength={4000} />}
          </Field>
          <Button type="submit" variant="primary">
            Report incident
          </Button>
        </Form>
      ) : null}
    </Section>
  );
}
