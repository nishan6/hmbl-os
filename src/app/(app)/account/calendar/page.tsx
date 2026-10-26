import { CalendarCheck, CalendarX } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import {
  FEED_FUTURE_DAYS,
  FEED_PAST_DAYS,
  getCalendarFeed,
} from "@/server/integrations/calendar-feed";
import { formatDateTime } from "@/lib/format";
import { ActionButton } from "@/components/ui/action-button";
import { Alert, PageHeader, Panel, Section } from "@/components/ui/page";
import { Tag } from "@/components/ui/status";
import { createFeedAction, revokeFeedAction } from "./actions";
import { FeedForm } from "./feed-form";

export const metadata = { title: "Calendar feed" };

export default async function CalendarFeedPage() {
  const actor = await requireActorOrRedirect();
  const allowed = can(actor, "projects.view");
  const feed = await getCalendarFeed(actor);

  return (
    <>
      <PageHeader
        title="Calendar feed"
        description="See project show dates, phases and milestones in your own calendar app."
        breadcrumbs={[{ label: "Account" }, { label: "Calendar feed" }]}
      />
      <Section
        title="Your calendar link"
        description={`A private address your calendar app checks for changes, usually every few hours. It lists the projects you can see in HMBL OS, from ${FEED_PAST_DAYS} days ago to about ${Math.round(FEED_FUTURE_DAYS / 30)} months ahead. It has dates, titles and venues, never amounts or contacts. It is read-only: changes made in your calendar don't come back.`}
      >
        <Panel className="flex flex-col gap-4">
          {!allowed ? (
            <Alert tone="info" title="No projects to show">
              The feed lists projects, and your role doesn&apos;t include viewing them.
            </Alert>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {feed ? (
                  <>
                    <Tag tone="success" className="gap-1">
                      <CalendarCheck className="size-3" aria-hidden /> On
                    </Tag>
                    <span className="text-secondary">
                      Made {formatDateTime(feed.createdAt)}.{" "}
                      {feed.lastUsedAt
                        ? `Last read by a calendar ${formatDateTime(feed.lastUsedAt)}.`
                        : "No calendar has read it yet."}
                    </span>
                  </>
                ) : (
                  <Tag tone="neutral" className="gap-1">
                    <CalendarX className="size-3" aria-hidden /> Off
                  </Tag>
                )}
              </div>
              <div className="flex flex-wrap items-start gap-3">
                <FeedForm action={createFeedAction} replace={!!feed} />
                {feed ? (
                  <ActionButton
                    action={revokeFeedAction}
                    fields={{}}
                    confirm="Turn the calendar link off? Calendars using it stop updating."
                    variant="secondary"
                    size="md"
                    pendingLabel="Turning off…"
                  >
                    Turn off
                  </ActionButton>
                ) : null}
              </div>
              <p className="text-secondary text-sm">
                Google Calendar can only read the link once HMBL OS is reachable on the internet.
                Lost the link, or think someone else has it? Make a new one: the old one stops
                working.
              </p>
            </>
          )}
        </Panel>
      </Section>
    </>
  );
}
