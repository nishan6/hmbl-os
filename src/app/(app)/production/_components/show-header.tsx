import Link from "next/link";
import { can, type Actor } from "@/server/permissions/authorize";
import type { ShowProject } from "@/server/production/access";
import { formatDate } from "@/lib/format";
import { PageHeader, type Crumb } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { PROJECT_STATUS } from "../../projects/_components/status";
import { ShowTabs, type ShowTab } from "./show-tabs";

export function ShowHeader({
  actor,
  show,
  current,
  crumb = [],
}: {
  actor: Actor;
  show: ShowProject;
  current: ShowTab;
  crumb?: Crumb[];
}) {
  const dates =
    show.eventStartDate &&
    (show.eventEndDate && show.eventEndDate.getTime() !== show.eventStartDate.getTime()
      ? `${formatDate(show.eventStartDate, "UTC")} – ${formatDate(show.eventEndDate, "UTC")}`
      : formatDate(show.eventStartDate, "UTC"));
  return (
    <>
      <PageHeader
        title={show.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={PROJECT_STATUS[show.status]} />
            {[show.venue, dates, show.number, show.legalEntity.code].filter(Boolean).join(" · ")}
            {show.isDemo ? <Tag tone="warning">Demo</Tag> : null}
          </span>
        }
        breadcrumbs={[
          { label: "Production", href: "/production" },
          ...(crumb.length
            ? [{ label: show.name, href: `/production/${show.id}` }, ...crumb]
            : [{ label: show.name }]),
        ]}
        actions={
          can(actor, "projects.view", { legalEntityId: show.legalEntityId }) ? (
            <Link href={`/projects/${show.id}`} className="text-accent text-sm hover:underline">
              Open the project
            </Link>
          ) : null
        }
      />
      <ShowTabs projectId={show.id} current={current} />
    </>
  );
}
