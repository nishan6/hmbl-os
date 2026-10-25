import Link from "next/link";
import { cn } from "@/lib/cn";
import type { IncidentSeverity, ShowUpdateStatus } from "@/generated/prisma/enums";
import type { StatusKey } from "@/components/ui/status";

export const SHOW_TABS = [
  { path: "", label: "Show day" },
  { path: "/run-of-show", label: "Run of show" },
  { path: "/call-sheets", label: "Call sheets" },
  { path: "/checklists", label: "Checklists" },
  { path: "/incidents", label: "Incidents" },
  { path: "/log", label: "Notes and log" },
] as const;

export type ShowTab = (typeof SHOW_TABS)[number]["path"];

export const UPDATE_STATUS: Record<ShowUpdateStatus, StatusKey> = {
  ON_TRACK: "on_track",
  DELAYED: "delayed",
  ISSUE: "issue",
  DONE: "completed",
  INFO: "information",
};

export const SEVERITY_TONE: Record<IncidentSeverity, "neutral" | "info" | "warning" | "danger"> = {
  LOW: "neutral",
  MEDIUM: "info",
  HIGH: "warning",
  CRITICAL: "danger",
};

/** The sections of one show, under the page header. */
export function ShowTabs({ projectId, current }: { projectId: string; current: ShowTab }) {
  return (
    <nav aria-label="Show" className="border-separator mb-6 flex gap-4 overflow-x-auto border-b">
      {SHOW_TABS.map((t) => (
        <Link
          key={t.path}
          href={`/production/${projectId}${t.path}`}
          aria-current={t.path === current ? "page" : undefined}
          className={cn(
            "text-secondary hover:text-text -mb-px border-b-2 border-transparent pb-2 text-base whitespace-nowrap",
            "aria-[current=page]:border-accent aria-[current=page]:text-text aria-[current=page]:font-medium",
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
