import Link from "next/link";
import { CalendarClock, CheckCircle2, Mail, MessageSquare, Phone, Users } from "lucide-react";
import { ACTIVITY_TYPES } from "@/server/crm/pipeline-schemas";
import { formatDateTime } from "@/lib/format";
import { ActionButton } from "@/components/ui/action-button";
import { StatusBadge } from "@/components/ui/status";
import { completeActivityAction } from "../opportunities/actions";

const ICONS = {
  NOTE: MessageSquare,
  CALL: Phone,
  MEETING: Users,
  EMAIL: Mail,
  FOLLOW_UP: CalendarClock,
} as const;

type Activity = {
  id: string;
  type: keyof typeof ACTIVITY_TYPES;
  subject: string;
  body: string | null;
  occurredAt: Date;
  dueAt: Date | null;
  completedAt: Date | null;
  owner: { name: string } | null;
  opportunity?: { id: string; title: string } | null;
};

/** Notes, calls, meetings and follow-ups, newest first. */
export function ActivityFeed({
  activities,
  canComplete,
  showOpportunity,
  timeZone,
}: {
  activities: Activity[];
  canComplete: boolean;
  showOpportunity?: boolean;
  /** The entity's time zone where there is one; otherwise India's. */
  timeZone?: string;
}) {
  if (!activities.length) return <p className="text-secondary text-base">Nothing recorded yet.</p>;
  const now = new Date();
  return (
    <ol className="flex flex-col gap-3">
      {activities.map((a) => {
        const Icon = ICONS[a.type];
        const overdue = a.type === "FOLLOW_UP" && !a.completedAt && a.dueAt && a.dueAt < now;
        return (
          <li key={a.id} className="border-separator flex gap-3 border-b pb-3 last:border-0">
            <Icon className="text-muted mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-text flex flex-wrap items-center gap-2 text-base font-medium">
                <span className="sr-only">{ACTIVITY_TYPES[a.type]}: </span>
                {a.subject}
                {a.type === "FOLLOW_UP" ? (
                  a.completedAt ? (
                    <StatusBadge status="completed" />
                  ) : overdue ? (
                    <StatusBadge status="overdue" />
                  ) : (
                    <StatusBadge status="due" />
                  )
                ) : null}
              </p>
              {a.body ? (
                <p className="text-secondary mt-0.5 text-sm whitespace-pre-line">{a.body}</p>
              ) : null}
              <p className="text-muted mt-1 text-xs">
                {ACTIVITY_TYPES[a.type]} · {a.owner?.name ?? "Unassigned"} ·{" "}
                {a.dueAt && !a.completedAt
                  ? `due ${formatDateTime(a.dueAt, timeZone)}`
                  : formatDateTime(a.completedAt ?? a.occurredAt, timeZone)}
                {showOpportunity && a.opportunity ? (
                  <>
                    {" · "}
                    <Link
                      href={`/crm/opportunities/${a.opportunity.id}`}
                      className="hover:text-text underline"
                    >
                      {a.opportunity.title}
                    </Link>
                  </>
                ) : null}
              </p>
            </div>
            {canComplete && a.type === "FOLLOW_UP" && !a.completedAt ? (
              <ActionButton action={completeActivityAction} fields={{ id: a.id }}>
                <CheckCircle2 aria-hidden />
                Done
              </ActionButton>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
