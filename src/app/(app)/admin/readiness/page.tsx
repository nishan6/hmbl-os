import Link from "next/link";
import { notFound } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { canSeeReadiness, getReadinessRun, listReadinessRuns } from "@/server/readiness/runs";
import { latestRestoreChecks } from "@/server/backups/history";
import { recentErrors } from "@/server/monitoring/errors";
import { AREAS, overall, type CheckState } from "@/lib/readiness";
import { formatDateTime } from "@/lib/format";
import { ActionButton } from "@/components/ui/action-button";
import { Alert, EmptyState, PageHeader, Section } from "@/components/ui/page";
import { StatusBadge, Tag, type StatusKey } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { runReadinessAction } from "./actions";

export const metadata = { title: "Readiness" };

const STATE: Record<CheckState, { status: StatusKey; label: string }> = {
  pass: { status: "passed", label: "Pass" },
  warn: { status: "warning", label: "Warning" },
  fail: { status: "failed", label: "Fail" },
};

const VERDICT: Record<CheckState, { tone: "success" | "warning" | "danger"; title: string }> = {
  pass: { tone: "success", title: "Every check passed" },
  warn: { tone: "warning", title: "No failures, but some checks need attention" },
  fail: {
    tone: "danger",
    title: "Some checks failed. Fix them before using HMBL OS for real work",
  },
};

export default async function ReadinessPage({ searchParams }: PageProps<"/admin/readiness">) {
  const actor = await requireActorOrRedirect();
  if (!canSeeReadiness(actor)) notFound();
  const params = await searchParams;
  const runId = typeof params.run === "string" ? params.run : undefined;
  const [run, runs, restores, errors] = await Promise.all([
    getReadinessRun(actor, runId).catch(() => notFound()),
    listReadinessRuns(actor),
    latestRestoreChecks(actor, 5),
    recentErrors(actor, { limit: 20 }),
  ]);
  const latest = runs[0]?.id === run?.id;
  const verdict = run
    ? VERDICT[overall({ pass: run.passCount, warn: run.warnCount, fail: run.failCount })]
    : null;

  return (
    <>
      <PageHeader
        title="Readiness"
        description="Checks that the books, the audit log, the database, backups and settings are safe to run the business on. Each run is kept as evidence."
        breadcrumbs={[{ label: "Administration" }, { label: "Readiness" }]}
        actions={
          <ActionButton
            action={runReadinessAction}
            fields={{}}
            variant="primary"
            size="md"
            pendingLabel="Checking…"
          >
            Run checks now
          </ActionButton>
        }
      />
      {!run ? (
        <EmptyState
          icon={ShieldCheck}
          title="No checks run yet"
          description="Run the checks here, or with pnpm readiness on the computer that runs HMBL OS."
        />
      ) : (
        <>
          <div className="mb-6 flex flex-col gap-2">
            <Alert tone={verdict!.tone} title={verdict!.title}>
              <span className="tabular">
                {run.passCount} passed, {run.warnCount} warnings, {run.failCount} failed
              </span>{" "}
              · {latest ? "Latest run" : "Earlier run"}, {formatDateTime(run.ranAt)} by{" "}
              {run.actorLabel} · database {run.database}, APP_ENV {run.appEnv}
            </Alert>
            {run.appEnv !== "production" ? (
              <p className="text-secondary text-sm">
                This is not the live database, so demo data is expected and problems show as
                warnings. Production readiness is judged on the live database only.
              </p>
            ) : null}
          </div>
          {Object.entries(AREAS).map(([area, label]) => {
            const checks = run.results.filter((r) => r.area === area);
            if (!checks.length) return null;
            return (
              <Section key={area} title={label}>
                <ul className="flex flex-col gap-3">
                  {checks.map((c) => (
                    <li
                      key={c.key}
                      className="border-separator bg-surface flex flex-col gap-2 rounded-lg border p-4 shadow-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-text text-base font-medium">{c.title}</h3>
                        <StatusBadge {...STATE[c.state]} />
                      </div>
                      <p className="text-secondary text-sm">{c.summary}</p>
                      {c.evidence.length ? (
                        <ul className="text-secondary tabular list-disc pl-5 text-xs">
                          {c.evidence.map((e, i) => (
                            <li key={i} className="break-words">
                              {e}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Section>
            );
          })}
        </>
      )}
      {runs.length ? (
        <Section
          title="Earlier runs"
          description="The latest 20. Runs are never changed or deleted."
        >
          <Table dense>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>By</TH>
                <TH>Database</TH>
                <TH align="right">Passed</TH>
                <TH align="right">Warnings</TH>
                <TH align="right">Failed</TH>
                <TH>Result</TH>
              </TR>
            </THead>
            <TBody>
              {runs.map((r) => (
                <TR key={r.id}>
                  <TD>
                    <Link
                      href={`/admin/readiness?run=${r.id}`}
                      className="text-accent hover:underline"
                    >
                      {formatDateTime(r.ranAt)}
                    </Link>
                    {r.id === run?.id ? <Tag className="ml-2">Shown</Tag> : null}
                  </TD>
                  <TD>{r.actorLabel}</TD>
                  <TD>
                    {r.database} <span className="text-muted">({r.appEnv})</span>
                  </TD>
                  <TD align="right">{r.passCount}</TD>
                  <TD align="right">{r.warnCount}</TD>
                  <TD align="right">{r.failCount}</TD>
                  <TD>
                    <StatusBadge
                      {...STATE[
                        overall({ pass: r.passCount, warn: r.warnCount, fail: r.failCount })
                      ]}
                    />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Section>
      ) : null}
      <Section
        title="Restore checks"
        description="Backups restored into a scratch database and checked with pnpm db:restore-check. Run one at least monthly."
      >
        {restores.length ? (
          <Table dense>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Backup</TH>
                <TH>Taken</TH>
                <TH align="right">Seconds</TH>
                <TH>Result</TH>
              </TR>
            </THead>
            <TBody>
              {restores.map((r) => (
                <TR key={r.id}>
                  <TD>{formatDateTime(r.checkedAt)}</TD>
                  <TD className="font-mono text-xs">{r.backupFile}</TD>
                  <TD>{formatDateTime(r.backupTakenAt)}</TD>
                  <TD align="right">{(r.durationMs / 1000).toFixed(1)}</TD>
                  <TD>
                    <StatusBadge {...STATE[r.passed ? "pass" : "fail"]} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState
            title="No backup has been test-restored"
            description="Run pnpm db:restore-check on the computer that runs HMBL OS."
          />
        )}
      </Section>
      <Section
        title="Server errors"
        description="The latest 20. A person who saw an error page can quote its reference, which is listed here. Kept for 90 days."
      >
        {errors.length ? (
          <Table dense>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Reference</TH>
                <TH>Where</TH>
                <TH>Error</TH>
              </TR>
            </THead>
            <TBody>
              {errors.map((e) => (
                <TR key={e.id}>
                  <TD className="whitespace-nowrap">{formatDateTime(e.occurredAt)}</TD>
                  <TD className="font-mono text-xs">{e.digest ?? "—"}</TD>
                  <TD className="text-xs">
                    {e.method} {e.routePath}
                  </TD>
                  <TD className="text-xs break-words">
                    {e.name}: {e.message}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState title="No server errors recorded" />
        )}
      </Section>
    </>
  );
}
