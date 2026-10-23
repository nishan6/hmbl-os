import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { effectiveProbability, getOpportunity, listStages } from "@/server/crm/pipeline";
import { listActivities } from "@/server/crm/activities";
import { NotFoundError } from "@/lib/errors";
import { formatDate, formatDateTime, formatMoney } from "@/lib/format";
import { formatBps } from "@/lib/percent";
import { Button } from "@/components/ui/button";
import { Alert, DetailList, PageHeader, Panel, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { addActivityAction, moveOpportunityAction } from "../actions";
import { ActivityFeed } from "../../_components/activity-feed";
import { ActivityForm } from "../../_components/activity-form";
import { STAGE_STATUS } from "../../_components/stage";
import { StageForm } from "./stage-form";
import { QuotesSection } from "../../../quotes/_components/quotes-section";

export const metadata = { title: "Opportunity" };

export default async function OpportunityPage({
  params,
  searchParams,
}: PageProps<"/crm/opportunities/[id]">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const actor = await requireActorOrRedirect();
  const o = await getOpportunity(actor, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const scope = { legalEntityId: o.legalEntityId };
  const canEdit = can(actor, "crm.edit", scope);
  const [stages, activities] = await Promise.all([
    listStages(actor, { includeArchived: true }),
    listActivities(actor, { opportunityId: id }),
  ]);
  const stageName = new Map(stages.map((s) => [s.id, s.name]));
  const probability = effectiveProbability(o);
  const tz = o.legalEntity.timezone;
  const date = (d: Date | null) => (d ? formatDate(d, "UTC") : null);
  const eventDates =
    o.eventStartDate && o.eventEndDate && +o.eventStartDate !== +o.eventEndDate
      ? `${date(o.eventStartDate)} – ${date(o.eventEndDate)}`
      : date(o.eventStartDate ?? o.eventEndDate);

  return (
    <>
      <PageHeader
        title={o.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/crm/clients/${o.client.id}`} className="text-accent hover:underline">
              {o.client.name}
            </Link>
            · {o.legalEntity.code}
            <StatusBadge status={STAGE_STATUS[o.stage.kind]!} />
            {o.stage.kind === "OPEN" ? (
              <span className="text-secondary">{o.stage.name}</span>
            ) : null}
            {o.isDemo ? <Tag tone="warning">Demo</Tag> : null}
          </span>
        }
        breadcrumbs={[
          { label: "CRM", href: "/crm" },
          { label: "Pipeline", href: "/crm" },
          { label: o.title },
        ]}
        actions={
          canEdit ? (
            <Button asChild>
              <Link href={`/crm/opportunities/${id}/edit`}>
                <Pencil aria-hidden />
                Edit
              </Link>
            </Button>
          ) : null
        }
      />
      {query.created ? (
        <div className="mb-6">
          <Alert tone="success" title="Opportunity created" />
        </div>
      ) : null}
      {o.outcomeReason ? (
        <div className="mb-6">
          <Alert tone={o.stage.kind === "WON" ? "success" : "info"} title={o.stage.name}>
            {o.outcomeReason}
          </Alert>
        </div>
      ) : null}

      <Section title="Details">
        <DetailList
          items={[
            {
              label: "Expected value",
              value:
                o.expectedValueMinor === null ? null : (
                  <span className="tabular">{formatMoney(o.expectedValueMinor, o.currency)}</span>
                ),
            },
            {
              label: "Win probability",
              value:
                probability === null ? null : (
                  <span className="tabular">
                    {formatBps(probability)}
                    {o.probabilityBps === null ? (
                      <span className="text-muted"> (stage default)</span>
                    ) : null}
                  </span>
                ),
            },
            { label: "Expected decision", value: date(o.expectedCloseDate) },
            { label: "Event dates", value: eventDates },
            { label: "Venue", value: o.venue },
            { label: "Contact", value: o.contact?.name },
            { label: "Owner", value: o.owner?.name },
            { label: "Business line", value: o.businessUnit?.name },
            { label: "Source", value: o.source },
            { label: "Competitors", value: o.competitors },
            { label: "HMBL entity", value: o.legalEntity.legalName },
            { label: "Closed", value: o.closedAt ? formatDateTime(o.closedAt, tz) : null },
          ]}
        />
        {o.description ? (
          <p className="text-secondary mt-4 max-w-prose text-base whitespace-pre-line">
            {o.description}
          </p>
        ) : null}
      </Section>

      {canEdit ? (
        <Section title="Stage">
          <Panel>
            <StageForm
              key={o.stageId}
              action={moveOpportunityAction.bind(null, id)}
              stages={stages.filter((s) => s.status === "ACTIVE")}
              current={o.stage}
            />
          </Panel>
        </Section>
      ) : null}

      <QuotesSection
        actor={actor}
        filter={{ opportunityId: id }}
        newHref={o.closedAt ? undefined : `/quotes/new?opportunityId=${id}`}
      />

      <div className="grid gap-x-8 xl:grid-cols-[2fr_1fr]">
        <Section title="Activity">
          {can(actor, "crm.create", scope) ? (
            <Panel className="mb-4">
              <ActivityForm action={addActivityAction.bind(null, { opportunityId: id })} />
            </Panel>
          ) : null}
          <ActivityFeed activities={activities} canComplete={canEdit} timeZone={tz} />
        </Section>

        <Section title="Stage history">
          <ol className="flex flex-col gap-2">
            {o.stageChanges.map((c) => (
              <li key={c.id} className="text-sm">
                <p className="text-text">
                  {c.fromStageId ? `${stageName.get(c.fromStageId)} → ` : "Created in "}
                  {stageName.get(c.toStageId)}
                </p>
                <p className="text-muted text-xs">
                  {c.actorLabel} · {formatDateTime(c.changedAt, tz)}
                </p>
                {c.reason ? <p className="text-secondary text-xs">{c.reason}</p> : null}
              </li>
            ))}
          </ol>
        </Section>
      </div>
    </>
  );
}
