import Link from "next/link";
import { notFound } from "next/navigation";
import { ScrollText } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { listAuditEvents } from "@/server/audit/query";
import { getEntityContext } from "@/server/shell/entity-context";
import { formatDateTime } from "@/lib/format";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata = { title: "Audit log" };

type Changes = Record<string, { from: unknown; to: unknown }>;

function describeChanges(changes: unknown): string {
  if (!changes || typeof changes !== "object") return "";
  return Object.entries(changes as Changes)
    .map(([field, { from, to }]) => `${field}: ${from ?? "—"} → ${to ?? "—"}`)
    .join("; ");
}

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "audit.view")) notFound();
  const params = await searchParams;
  const cursor = typeof params.after === "string" ? params.after : undefined;
  const action = typeof params.action === "string" && params.action ? params.action : undefined;
  const { selectedId } = await getEntityContext(actor);
  const { events, nextCursor } = await listAuditEvents(actor, {
    cursor,
    action,
    legalEntityId: selectedId ?? undefined,
    limit: 50,
  });

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every recorded change, newest first. Entries can't be edited or deleted."
        breadcrumbs={[{ label: "Administration" }, { label: "Audit log" }]}
      />
      <form className="mb-4 flex items-end gap-2" role="search">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Action
          <input
            name="action"
            defaultValue={action}
            placeholder="e.g. user.role_granted"
            className="h-control border-border bg-surface w-64 rounded-md border px-2.5 text-base font-normal"
          />
        </label>
        <button type="submit" className={buttonClasses("secondary")}>
          Filter
        </button>
        {action ? (
          <Link href="/admin/audit" className={buttonClasses("quiet")}>
            Clear
          </Link>
        ) : null}
      </form>
      {events.length ? (
        <>
          <Table dense>
            <THead>
              <tr>
                <TH>When</TH>
                <TH>Who</TH>
                <TH>Action</TH>
                <TH>Target</TH>
                <TH>Changes</TH>
              </tr>
            </THead>
            <TBody>
              {events.map((e) => (
                <TR key={e.id}>
                  <TD className="tabular text-secondary whitespace-nowrap">
                    {formatDateTime(e.occurredAt)}
                  </TD>
                  <TD className="max-w-56 truncate" title={e.actorLabel}>
                    {e.actorLabel}
                  </TD>
                  <TD className="font-mono text-xs">{e.action}</TD>
                  <TD className="text-secondary">{e.targetType}</TD>
                  <TD
                    className="text-secondary max-w-md truncate"
                    title={describeChanges(e.changes)}
                  >
                    {describeChanges(e.changes) || "—"}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <div className="mt-4 flex gap-2">
            {cursor ? (
              <Link
                href={`/admin/audit${action ? `?action=${encodeURIComponent(action)}` : ""}`}
                className={buttonClasses("secondary")}
              >
                Newest
              </Link>
            ) : null}
            {nextCursor ? (
              <Link
                href={`/admin/audit?after=${nextCursor}${action ? `&action=${encodeURIComponent(action)}` : ""}`}
                className={buttonClasses("secondary")}
              >
                Older
              </Link>
            ) : null}
          </div>
        </>
      ) : (
        <EmptyState icon={ScrollText} title="No matching events" />
      )}
    </>
  );
}
