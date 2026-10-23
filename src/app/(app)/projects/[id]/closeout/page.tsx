import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { canSeeProjectCosts, getProject } from "@/server/projects/projects";
import { getCloseout } from "@/server/projects/closeout";
import { isLocked, isPreApproval } from "@/server/projects/lifecycle";
import { AppError } from "@/lib/errors";
import { formatDateTime } from "@/lib/format";
import { Alert, Panel, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { ProjectHeader } from "../../_components/project-header";
import { CommandForm } from "../changes/change-forms";
import { closeoutItemAction } from "./actions";

export const metadata = { title: "Project closeout" };

export default async function ProjectCloseoutPage({
  params,
}: PageProps<"/projects/[id]/closeout">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const [p, closeout] = await Promise.all([getProject(actor, id), getCloseout(actor, id)]).catch(
    (error: unknown) => {
      if (error instanceof AppError) notFound();
      throw error;
    },
  );
  const canEdit =
    can(actor, "projects.edit", { legalEntityId: p.legalEntityId }) &&
    !isLocked(p.status) &&
    !isPreApproval(p.status);
  const done = closeout.items.length - closeout.outstanding.length;

  return (
    <>
      <ProjectHeader
        project={p}
        current="/closeout"
        showCosts={canSeeProjectCosts(actor, p.legalEntityId)}
      />

      <div className="mb-6">
        {closeout.outstanding.length ? (
          <Alert tone="info" title={`${done} of ${closeout.items.length} closeout items finished`}>
            The project can close once every item is done or marked not applicable. The Director can
            still close it earlier from the{" "}
            <Link href={`/projects/${p.id}`} className="underline">
              overview
            </Link>
            , giving a reason. That is recorded as an override.
          </Alert>
        ) : (
          <Alert tone="success" title="Closeout finished">
            Every item is done or not applicable. The project can be closed from the overview.
          </Alert>
        )}
      </div>

      <Section
        title="Closeout checklist"
        description="Invoicing and payments are confirmed by hand until Finance tracks them."
      >
        <ul className="flex flex-col gap-3">
          {closeout.items.map((item) => {
            const row = item.row;
            const state = row?.doneAt ? "done" : row?.notApplicable ? "not_applicable" : "open";
            return (
              <li key={item.key}>
                <Panel>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-text text-sm font-semibold">{item.label}</h3>
                    {state === "done" ? (
                      <StatusBadge status="completed" />
                    ) : state === "not_applicable" ? (
                      <Tag>Not applicable</Tag>
                    ) : (
                      <StatusBadge status="open" />
                    )}
                  </div>
                  {row && state !== "open" ? (
                    <p className="text-muted mt-1 text-xs">
                      {row.updatedByLabel} · {formatDateTime(row.updatedAt, p.legalEntity.timezone)}
                      {row.note ? ` · ${row.note}` : ""}
                    </p>
                  ) : null}
                  {item.key === "FINAL_REPORT" && !closeout.finalReport ? (
                    <p className="text-secondary mt-1 text-xs">
                      Upload the report under{" "}
                      <Link href={`/projects/${p.id}/documents`} className="text-accent underline">
                        Documents
                      </Link>{" "}
                      as a closeout report first.
                    </p>
                  ) : null}
                  {canEdit ? (
                    <div className="mt-3">
                      <CommandForm
                        action={closeoutItemAction.bind(null, p.id, item.key)}
                        label="Note"
                        buttons={
                          state === "open"
                            ? [
                                { command: "done", label: "Mark done", primary: true },
                                { command: "not_applicable", label: "Not applicable" },
                              ]
                            : [{ command: "open", label: "Reopen" }]
                        }
                      />
                    </div>
                  ) : null}
                </Panel>
              </li>
            );
          })}
        </ul>
      </Section>
    </>
  );
}
