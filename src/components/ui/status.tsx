import {
  Ban,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleX,
  Clock,
  CloudOff,
  FileText,
  Loader,
  PauseCircle,
  Send,
  TriangleAlert,
  Trophy,
  Archive,
  RefreshCw,
  History,
  Undo2,
  CalendarRange,
  Flag,
  Calculator,
  Lock,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

/**
 * The one status vocabulary for every module (spec §24.11). Each status has a
 * label, an icon and a tone, so meaning never depends on colour alone.
 */
export const STATUSES = {
  draft: { label: "Draft", icon: FileText, tone: "neutral" },
  pending_review: { label: "Pending review", icon: Clock, tone: "info" },
  pending_approval: { label: "Pending approval", icon: Clock, tone: "warning" },
  approved: { label: "Approved", icon: CircleCheck, tone: "success" },
  rejected: { label: "Rejected", icon: CircleX, tone: "danger" },
  issued: { label: "Issued", icon: Send, tone: "info" },
  partially_paid: { label: "Partially paid", icon: CircleDashed, tone: "warning" },
  paid: { label: "Paid", icon: CircleCheck, tone: "success" },
  overdue: { label: "Overdue", icon: TriangleAlert, tone: "danger" },
  posted: { label: "Posted", icon: CircleCheck, tone: "accent" },
  voided: { label: "Voided", icon: Ban, tone: "neutral" },
  cancelled: { label: "Cancelled", icon: Ban, tone: "neutral" },
  on_hold: { label: "On hold", icon: PauseCircle, tone: "warning" },
  in_progress: { label: "In progress", icon: Loader, tone: "info" },
  completed: { label: "Completed", icon: CircleCheck, tone: "success" },
  failed: { label: "Failed", icon: CircleX, tone: "danger" },
  offline: { label: "Offline", icon: CloudOff, tone: "neutral" },
  pending_sync: { label: "Pending sync", icon: RefreshCw, tone: "warning" },
  active: { label: "Active", icon: CircleDot, tone: "success" },
  archived: { label: "Archived", icon: Archive, tone: "neutral" },
  disabled: { label: "Disabled", icon: Ban, tone: "neutral" },
  open: { label: "Open", icon: CircleDot, tone: "info" },
  due: { label: "Due", icon: Clock, tone: "info" },
  won: { label: "Won", icon: Trophy, tone: "success" },
  lost: { label: "Lost", icon: CircleX, tone: "danger" },
  accepted: { label: "Accepted", icon: CircleCheck, tone: "success" },
  declined: { label: "Declined", icon: CircleX, tone: "danger" },
  superseded: { label: "Superseded", icon: History, tone: "neutral" },
  withdrawn: { label: "Withdrawn", icon: Undo2, tone: "neutral" },
  planning: { label: "Planning", icon: CalendarRange, tone: "info" },
  ready: { label: "Ready", icon: Flag, tone: "accent" },
  financial_close: { label: "Financial close", icon: Calculator, tone: "warning" },
  closed: { label: "Closed", icon: Lock, tone: "neutral" },
  credited: { label: "Credited", icon: Undo2, tone: "neutral" },
  reopened: { label: "Reopened", icon: History, tone: "warning" },
  proposed: { label: "Proposed", icon: Clock, tone: "info" },
  confirmed: { label: "Confirmed", icon: CircleCheck, tone: "success" },
  available: { label: "Available", icon: CircleCheck, tone: "success" },
  out_of_service: { label: "Out of service", icon: Wrench, tone: "warning" },
  retired: { label: "Retired", icon: Archive, tone: "neutral" },
} as const satisfies Record<string, { label: string; icon: LucideIcon; tone: Tone }>;

export type StatusKey = keyof typeof STATUSES;

const tones: Record<Tone, string> = {
  neutral: "bg-neutral-soft text-neutral",
  info: "bg-info-soft text-info",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  accent: "bg-accent-soft text-accent",
};

export function StatusBadge({ status, className }: { status: StatusKey; className?: string }) {
  const { label, icon: Icon, tone } = STATUSES[status];
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-xs font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  );
}

/** A small neutral label, e.g. "Demo" or a code. */
export function Tag({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-sm px-1.5 text-xs font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
