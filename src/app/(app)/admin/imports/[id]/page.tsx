import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { getImport } from "@/server/imports/batches";
import { AppError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { IMPORT_KINDS, type ImportKind } from "@/lib/imports";
import { ActionButton } from "@/components/ui/action-button";
import { buttonClasses } from "@/components/ui/button";
import { Alert, DetailList, EmptyState, PageHeader, Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  commitImportAction,
  correctRowAction,
  decideAllAction,
  decideRowAction,
  discardImportAction,
  dryRunAction,
  saveMappingAction,
} from "../actions";
import { BATCH_STATUS, DECISION_LABEL, ROW_OUTCOME, ROW_STATUS } from "../statuses";
import { CorrectionForm, DryRunForm, MappingForm } from "./import-forms";

export const metadata = { title: "Import" };

/** The most rows the page lists; the rest are in the problem download or a narrower filter. */
const SHOWN = 200;

const RECORD_HREF: Record<ImportKind, (id: string) => string> = {
  CLIENTS: (id) => `/crm/clients/${id}`,
  VENDORS: (id) => `/finance/vendors/${id}`,
  CREW: (id) => `/crew/${id}`,
  EQUIPMENT: (id) => `/equipment/${id}`,
};

const FILTERS = [
  ["all", "All rows"],
  ["problems", "Problems"],
  ["duplicates", "Possible duplicates"],
  ["ready", "Ready"],
] as const;
type Filter = (typeof FILTERS)[number][0];

export default async function ImportPage({
  params,
  searchParams,
}: PageProps<"/admin/imports/[id]">) {
  const actor = await requireActorOrRedirect();
  const { id } = await params;
  const query = await searchParams;
  let data: Awaited<ReturnType<typeof getImport>>;
  try {
    data = await getImport(actor, id);
  } catch (error) {
    if (error instanceof AppError) notFound();
    throw error;
  }
  const { batch, mapping, missing, fields, people, previous, canUpdate, rows, plan } = data;
  const kind = IMPORT_KINDS[batch.kind];
  const staged = batch.status === "STAGED";
  const filter: Filter = FILTERS.some(([k]) => k === query.show) ? (query.show as Filter) : "all";
  const failed = (r: (typeof rows)[number]) =>
    r.status === "INVALID" || r.outcome === "FAILED" || r.outcome === "REJECTED";
  const filtered = rows.filter((r) =>
    filter === "problems"
      ? failed(r)
      : filter === "duplicates"
        ? r.status === "DUPLICATE"
        : filter === "ready"
          ? r.status === "VALID"
          : true,
  );
  const problemCount = rows.filter(failed).length;
  const duplicates = rows.filter((r) => r.status === "DUPLICATE").length;
  const labelOf = new Map(fields.map((f) => [f.key, f.label]));
  const summaryOf = (values: Record<string, string>) =>
    fields
      .filter((f) => f.required)
      .map((f) => values[f.key])
      .filter(Boolean)
      .join(" · ");
  const summary = (batch.summary ?? {}) as Record<string, number>;

  return (
    <>
      <PageHeader
        title={batch.fileName}
        description={`${kind.label} · read by ${people.get(batch.createdById) ?? "someone"} on ${formatDateTime(batch.createdAt)}`}
        breadcrumbs={[
          { label: "Administration" },
          { label: "Imports", href: "/admin/imports" },
          { label: batch.fileName },
        ]}
        actions={
          <>
            {problemCount ? (
              <a href={`/api/imports/${batch.id}/problems`} className={buttonClasses("secondary")}>
                Download problem rows
              </a>
            ) : null}
            {staged ? (
              <ActionButton
                action={discardImportAction.bind(null, batch.id)}
                fields={{}}
                confirm="Discard this import? Nothing from it has been saved, and it can't be committed later."
                variant="quiet"
                size="md"
              >
                Discard
              </ActionButton>
            ) : null}
          </>
        }
      />

      <div className="mb-6 flex flex-col gap-3">
        {previous ? (
          <Alert tone="warning" title="This exact file was imported before">
            <Link href={`/admin/imports/${previous.id}`} className="underline">
              {previous.fileName}
            </Link>{" "}
            was committed on {formatDateTime(previous.committedAt!)}. Committing it again would
            likely find its rows as possible duplicates.
          </Alert>
        ) : null}
        {staged && missing.length ? (
          <Alert tone="danger" title="Required fields have no column">
            Choose a column or one value for: {missing.map((f) => f.label).join(", ")}.
          </Alert>
        ) : null}
        {batch.status === "COMMITTING" ? (
          <Alert tone="warning" title="This import is being written">
            If it stopped part-way (a closed tab or a lost connection), you can commit it again
            after 15 minutes: rows already written are not written twice.
          </Alert>
        ) : null}
      </div>

      <Section title="Summary">
        <DetailList
          items={[
            { label: "Status", value: <StatusBadge {...BATCH_STATUS[batch.status]} /> },
            { label: "Rows in the file", value: <span className="tabular">{batch.rowCount}</span> },
            ...(batch.status === "COMMITTED"
              ? [
                  {
                    label: "Imported",
                    value: `${formatDateTime(batch.committedAt!)} by ${people.get(batch.committedById ?? "") ?? "someone"}`,
                  },
                  {
                    label: "Created",
                    value: <span className="tabular">{summary.CREATED ?? 0}</span>,
                  },
                  {
                    label: "Updated",
                    value: <span className="tabular">{summary.UPDATED ?? 0}</span>,
                  },
                  {
                    label: "Skipped",
                    value: <span className="tabular">{summary.SKIPPED ?? 0}</span>,
                  },
                  {
                    label: "Not imported (problems)",
                    value: <span className="tabular">{summary.REJECTED ?? 0}</span>,
                  },
                  {
                    label: "Failed",
                    value: <span className="tabular">{summary.FAILED ?? 0}</span>,
                  },
                ]
              : [
                  {
                    label: "Would create",
                    value: <span className="tabular">{plan.create}</span>,
                  },
                  {
                    label: "Would update",
                    value: <span className="tabular">{plan.update}</span>,
                  },
                  { label: "Would skip", value: <span className="tabular">{plan.skip}</span> },
                  {
                    label: "With problems (won't be imported)",
                    value: <span className="tabular">{plan.rejected}</span>,
                  },
                  {
                    label: "Duplicates needing a decision",
                    value: <span className="tabular">{plan.undecided}</span>,
                  },
                ]),
            ...(batch.status === "DISCARDED"
              ? [
                  {
                    label: "Discarded",
                    value: `${formatDateTime(batch.discardedAt!)} by ${people.get(batch.discardedById ?? "") ?? "someone"}`,
                  },
                ]
              : []),
          ]}
        />
      </Section>

      {staged ? (
        <>
          <Section
            title="Columns"
            description="Which column of the file fills each field. Changing this checks every row again."
          >
            <details open={missing.length > 0}>
              <summary className="text-accent cursor-pointer text-sm font-medium">
                {missing.length ? "Map the required fields" : "Review the mapping"}
              </summary>
              <div className="mt-4">
                <MappingForm
                  action={saveMappingAction.bind(null, batch.id)}
                  fields={fields}
                  headers={batch.headers}
                  sample={rows[0]?.values ?? []}
                  mapping={mapping}
                />
              </div>
            </details>
          </Section>

          <Section
            title="Check and commit"
            description="The dry run checks every row against today's records and writes nothing. Committing runs it again first."
          >
            <div className="flex flex-col gap-4">
              {plan.undecided ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-secondary">
                    For the {plan.undecided} undecided possible duplicates:
                  </span>
                  <ActionButton
                    action={decideAllAction.bind(null, batch.id)}
                    fields={{ decision: "SKIP" }}
                    variant="secondary"
                  >
                    Skip them all
                  </ActionButton>
                  <ActionButton
                    action={decideAllAction.bind(null, batch.id)}
                    fields={{ decision: "CREATE" }}
                    confirm="Create a new record for every undecided possible duplicate that allows it? Rows that match on a tax ID or SKU are left for you."
                    variant="quiet"
                  >
                    Create new records for them
                  </ActionButton>
                </div>
              ) : null}
              <DryRunForm action={dryRunAction.bind(null, batch.id)} />
              <div>
                <ActionButton
                  action={commitImportAction.bind(null, batch.id)}
                  fields={{}}
                  confirm={`Commit this import? It creates ${plan.create} and updates ${plan.update} ${kind.label.toLowerCase()}. Each record is written like one typed in and can't be removed in bulk afterwards.`}
                  variant="primary"
                  size="md"
                  pendingLabel="Importing…"
                >
                  Commit import
                </ActionButton>
              </div>
            </div>
          </Section>
        </>
      ) : null}

      <Section
        title="Rows"
        description={`Line numbers are the file's own: the column names are line 1.`}
      >
        <nav aria-label="Filter rows" className="mb-3 flex flex-wrap gap-1">
          {FILTERS.map(([key, label]) => (
            <Link
              key={key}
              href={
                key === "all"
                  ? `/admin/imports/${batch.id}`
                  : `/admin/imports/${batch.id}?show=${key}`
              }
              aria-current={filter === key ? "page" : undefined}
              className={buttonClasses(filter === key ? "secondary" : "quiet", "sm")}
            >
              {label}
              {key === "problems"
                ? ` (${problemCount})`
                : key === "duplicates"
                  ? ` (${duplicates})`
                  : ""}
            </Link>
          ))}
        </nav>
        {filtered.length ? (
          <>
            {filtered.length > SHOWN ? (
              <p className="text-secondary mb-2 text-sm">
                Showing the first {SHOWN} of {filtered.length} rows. Narrow the list, or download
                the problem rows.
              </p>
            ) : null}
            <Table dense>
              <THead>
                <TR>
                  <TH align="right">Line</TH>
                  <TH>Status</TH>
                  <TH>Row</TH>
                  <TH>Details</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.slice(0, SHOWN).map((r) => {
                  const problems = Object.entries(r.errors).map(([key, messages]) =>
                    key === "_row"
                      ? messages.join(" ")
                      : `${labelOf.get(key) ?? key}: ${messages.join(" ")}`,
                  );
                  return (
                    <TR key={r.id} className="align-top">
                      <TD align="right" className="py-2 align-top">
                        {r.line}
                      </TD>
                      <TD className="py-2 align-top">
                        <StatusBadge
                          {...(r.outcome ? ROW_OUTCOME[r.outcome] : ROW_STATUS[r.status])}
                        />
                      </TD>
                      <TD className="py-2 align-top">
                        {r.recordId ? (
                          <Link
                            href={RECORD_HREF[batch.kind](r.recordId)}
                            className="text-accent hover:underline"
                          >
                            {summaryOf(r.fields) || "—"}
                          </Link>
                        ) : (
                          summaryOf(r.fields) || <span className="text-muted">Blank</span>
                        )}
                        {Object.keys(r.edits).length ? (
                          <span className="text-muted block text-xs">Corrected here</span>
                        ) : null}
                      </TD>
                      <TD className="py-2 align-top">
                        <div className="flex flex-col gap-1.5">
                          {r.outcomeMessage ? (
                            <p className="text-danger text-sm">{r.outcomeMessage}</p>
                          ) : problems.length ? (
                            <ul className="text-danger list-inside list-disc text-sm">
                              {problems.map((p) => (
                                <li key={p}>{p}</li>
                              ))}
                            </ul>
                          ) : null}
                          {r.status === "DUPLICATE" && r.matchId ? (
                            <p className="text-sm">
                              {r.matchReason} as{" "}
                              <Link
                                href={RECORD_HREF[batch.kind](r.matchId)}
                                className="text-accent hover:underline"
                              >
                                {r.matchLabel}
                              </Link>
                              {r.decision ? (
                                <span className="text-secondary">
                                  {" "}
                                  · Decided: {DECISION_LABEL[r.decision]}
                                </span>
                              ) : null}
                            </p>
                          ) : null}
                          {staged && r.status === "DUPLICATE" ? (
                            <div className="flex flex-wrap gap-1">
                              {canUpdate ? (
                                <ActionButton
                                  action={decideRowAction.bind(null, r.id)}
                                  fields={{ decision: "UPDATE" }}
                                  variant={r.decision === "UPDATE" ? "secondary" : "quiet"}
                                >
                                  Update {r.matchLabel}
                                </ActionButton>
                              ) : null}
                              {r.matchCanCreate ? (
                                <ActionButton
                                  action={decideRowAction.bind(null, r.id)}
                                  fields={{ decision: "CREATE" }}
                                  variant={r.decision === "CREATE" ? "secondary" : "quiet"}
                                >
                                  Create a new record
                                </ActionButton>
                              ) : null}
                              <ActionButton
                                action={decideRowAction.bind(null, r.id)}
                                fields={{ decision: "SKIP" }}
                                variant={r.decision === "SKIP" ? "secondary" : "quiet"}
                              >
                                Skip
                              </ActionButton>
                            </div>
                          ) : null}
                          {staged && r.status !== "VALID" ? (
                            <details>
                              <summary className="text-accent cursor-pointer text-sm">
                                Correct line {r.line}
                              </summary>
                              <CorrectionForm
                                action={correctRowAction.bind(null, r.id)}
                                fields={fields}
                                values={r.fields}
                                errors={r.errors}
                              />
                            </details>
                          ) : null}
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </>
        ) : (
          <EmptyState title="No rows match" />
        )}
      </Section>
    </>
  );
}
