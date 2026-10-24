import Link from "next/link";
import { Bell, Circle, CircleCheck, Settings } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { listNotifications } from "@/server/notifications/service";
import { formatDateTime } from "@/lib/format";
import { ActionButton } from "@/components/ui/action-button";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { markAllReadAction, openNotificationAction } from "./actions";

export const metadata = { title: "Notifications" };

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function NotificationsPage({ searchParams }: PageProps<"/notifications">) {
  const actor = await requireActorOrRedirect();
  const unreadOnly = str((await searchParams).show) === "unread";
  const items = await listNotifications(actor, { unread: unreadOnly });
  const unread = items.filter((n) => !n.readAt).length;

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Things you should know about. They never approve anything: approvals happen on the record, from Approvals."
        actions={
          <>
            <Link href="/notifications/settings" className={buttonClasses("quiet")}>
              <Settings aria-hidden />
              Settings
            </Link>
            {unread ? (
              <ActionButton action={markAllReadAction} fields={{}} variant="secondary" size="md">
                Mark all read
              </ActionButton>
            ) : null}
          </>
        }
      />
      <nav aria-label="Show" className="mb-4 flex gap-3 text-sm">
        <Link
          href="/notifications"
          aria-current={!unreadOnly ? "page" : undefined}
          className="text-secondary aria-[current=page]:text-text aria-[current=page]:font-medium"
        >
          All
        </Link>
        <Link
          href="/notifications?show=unread"
          aria-current={unreadOnly ? "page" : undefined}
          className="text-secondary aria-[current=page]:text-text aria-[current=page]:font-medium"
        >
          Unread
        </Link>
      </nav>
      {items.length ? (
        <ul className="border-separator bg-elevated divide-separator divide-y rounded-lg border">
          {items.map((n) => (
            <li key={n.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
              {n.readAt ? (
                <span className="text-muted mt-0.5 inline-flex items-center gap-1 text-xs">
                  <CircleCheck aria-hidden className="size-3.5" />
                  Read
                </span>
              ) : (
                <span className="text-accent mt-0.5 inline-flex items-center gap-1 text-xs font-medium">
                  <Circle aria-hidden className="fill-accent size-3.5" />
                  New
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p
                  className={n.readAt ? "text-secondary text-sm" : "text-text text-sm font-medium"}
                >
                  {n.title}
                </p>
                {n.body ? <p className="text-secondary text-sm">{n.body}</p> : null}
                <p className="text-muted tabular text-xs">{formatDateTime(n.createdAt)}</p>
              </div>
              {n.href ? (
                <ActionButton action={openNotificationAction.bind(null, n.id)} fields={{}}>
                  Open<span className="sr-only">: {n.title}</span>
                </ActionButton>
              ) : !n.readAt ? (
                <ActionButton action={openNotificationAction.bind(null, n.id)} fields={{}}>
                  Mark read<span className="sr-only">: {n.title}</span>
                </ActionButton>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={Bell}
          title={unreadOnly ? "Nothing unread" : "No notifications yet"}
          description="Approvals waiting for you, decisions on your requests and dates coming up appear here."
        />
      )}
    </>
  );
}
