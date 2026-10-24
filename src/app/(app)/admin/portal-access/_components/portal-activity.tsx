import type { PortalActivityItem } from "@/server/portal/activity";
import { formatDateTime } from "@/lib/format";
import { Panel, Section } from "@/components/ui/page";

/** What someone outside HMBL did in the portal for this record. Nothing if they did nothing. */
export function PortalActivity({
  items,
  title = "From the portal",
  timeZone,
}: {
  items: PortalActivityItem[];
  title?: string;
  timeZone?: string;
}) {
  if (!items.length) return null;
  return (
    <Section title={title} description="Recorded in the portal. It can't be edited or deleted.">
      <ol className="flex flex-col gap-3">
        {items.map((i) => (
          <li key={i.id}>
            <Panel className="flex flex-col gap-1 text-sm">
              <p className="text-text font-medium">{i.title}</p>
              <p className="text-muted text-xs">
                {i.by} · {formatDateTime(i.at, timeZone)}
              </p>
              {i.body ? <p className="text-secondary whitespace-pre-line">{i.body}</p> : null}
            </Panel>
          </li>
        ))}
      </ol>
    </Section>
  );
}
