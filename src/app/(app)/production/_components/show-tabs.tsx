import Link from "next/link";
import { cn } from "@/lib/cn";
import type { IncidentSeverity, ShowUpdateStatus } from "@/generated/prisma/enums";
import type { StatusKey } from "@/components/ui/status";
import { tab, tabList } from "@/components/ui/tabs";

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
    <nav aria-label="Show" className={tabList}>
      {SHOW_TABS.map((t) => (
        <Link
          key={t.path}
          href={`/production/${projectId}${t.path}`}
          aria-current={t.path === current ? "page" : undefined}
          className={cn(tab)}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
