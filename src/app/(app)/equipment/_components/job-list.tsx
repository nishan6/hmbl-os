import Link from "next/link";
import type { EquipmentMaintenance } from "@/generated/prisma/client";
import { MAINTENANCE_KINDS } from "@/server/equipment/maintenance";
import { CONDITIONS } from "@/server/equipment/inventory";
import { readChecklist } from "@/lib/equipment";
import { formatDate, formatMoney } from "@/lib/format";
import { ActionButton } from "@/components/ui/action-button";
import { StatusBadge, Tag, type StatusKey } from "@/components/ui/status";
import {
  cancelJobAction,
  completeJobAction,
  returnStockAction,
  writeOffStockAction,
} from "../actions";
import { CompleteJobForm, ReasonForm } from "../equipment-forms";

const JOB_STATUS: Record<EquipmentMaintenance["status"], StatusKey> = {
  OPEN: "open",
  DONE: "completed",
  CANCELLED: "cancelled",
};

const date = (d: Date) => formatDate(d, "UTC");

type Job = EquipmentMaintenance & {
  asset?: { id: string; assetTag: string } | null;
  location?: { code: string } | null;
  vendor?: { name: string } | null;
};

/** Maintenance jobs with what each still needs: closing, or stock returning to service. */
export function JobList({
  jobs,
  rights,
  vendors,
  currency,
}: {
  jobs: Job[];
  rights: { edit: boolean; approve: boolean; archive: boolean };
  vendors: { id: string; label: string }[];
  currency: string;
}) {
  if (!jobs.length) return <p className="text-secondary text-sm">No maintenance recorded.</p>;
  return (
    <ul className="flex flex-col gap-3">
      {jobs.map((j) => {
        const checks = readChecklist(j.checklist);
        const holdingStock =
          !j.assetId && j.takesOutOfService && !j.returnedToServiceAt && j.status !== "OPEN";
        return (
          <li key={j.id} className="border-separator rounded-md border p-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={JOB_STATUS[j.status]} />
              <span className="text-text font-medium">{j.title}</span>
              <span className="text-secondary text-sm">{MAINTENANCE_KINDS[j.kind]}</span>
              {j.asset ? (
                <Link
                  href={`/equipment/assets/${j.asset.id}`}
                  className="text-accent tabular text-sm hover:underline"
                >
                  {j.asset.assetTag}
                </Link>
              ) : (
                <span className="tabular text-secondary text-sm">
                  {j.quantity} at {j.location?.code ?? "—"}
                </span>
              )}
              {j.takesOutOfService && !j.returnedToServiceAt ? (
                <Tag tone="warning">Holding out of service</Tag>
              ) : null}
              {j.passed === false ? <StatusBadge status="failed" /> : null}
            </div>
            <p className="text-muted tabular mt-1 text-xs">
              Reported {date(j.reportedAt)}
              {j.blockFrom
                ? ` · Planned downtime ${date(j.blockFrom)}${j.blockTo && j.blockTo.getTime() !== j.blockFrom.getTime() ? ` – ${date(j.blockTo)}` : ""}`
                : ""}
              {j.completedAt ? ` · Closed ${date(j.completedAt)}` : ""}
              {j.returnedToServiceAt ? ` · Back in service ${date(j.returnedToServiceAt)}` : ""}
            </p>
            {j.details ? <p className="text-secondary mt-1 text-sm">{j.details}</p> : null}
            {j.outcome ? (
              <p className="text-text mt-1 text-sm whitespace-pre-line">{j.outcome}</p>
            ) : null}
            {j.costMinor !== null && j.currency ? (
              <p className="text-secondary mt-1 text-sm">
                Cost <span className="tabular">{formatMoney(j.costMinor, j.currency)}</span>
                {j.vendor ? ` · ${j.vendor.name}` : ""}
              </p>
            ) : null}
            {j.status !== "OPEN" && checks.length ? (
              <ul className="mt-1 text-sm">
                {checks.map((c) => (
                  <li key={c.label} className={c.passed ? "text-success" : "text-danger"}>
                    {c.passed ? "Passed" : "Failed"}: {c.label}
                  </li>
                ))}
              </ul>
            ) : null}
            {j.status === "OPEN" && rights.edit ? (
              <div className="mt-3 grid gap-4 lg:grid-cols-[2fr_1fr]">
                <CompleteJobForm
                  action={completeJobAction.bind(null, j.id)}
                  checklist={checks.map((c) => c.label)}
                  vendors={vendors}
                  conditions={j.assetId ? CONDITIONS : undefined}
                  defaults={{ currency }}
                />
                <ReasonForm
                  action={cancelJobAction.bind(null, j.id)}
                  label="Why cancel it"
                  submitLabel="Cancel job"
                />
              </div>
            ) : null}
            {holdingStock && (rights.approve || rights.archive) ? (
              <div className="mt-3 flex flex-wrap items-start gap-4">
                {rights.approve ? (
                  <ActionButton
                    action={returnStockAction}
                    fields={{ jobId: j.id }}
                    variant="secondary"
                  >
                    Return {j.quantity} to service
                  </ActionButton>
                ) : null}
                {rights.archive ? (
                  <ReasonForm
                    action={writeOffStockAction.bind(null, j.id)}
                    label="Why write it off"
                    submitLabel={`Write off ${j.quantity}`}
                  />
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
