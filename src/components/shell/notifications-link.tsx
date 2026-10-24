import Link from "next/link";
import { Bell } from "lucide-react";

/** The bell in the top bar, with the number of unread notifications. */
export function NotificationsLink({ unread }: { unread: number }) {
  const label = unread ? `Notifications, ${unread} unread` : "Notifications, none unread";
  return (
    <Link
      href="/notifications"
      aria-label={label}
      title={label}
      className="text-secondary hover:text-text hover:bg-hover relative inline-flex size-8 items-center justify-center rounded-md"
    >
      <Bell aria-hidden className="size-4" />
      {unread ? (
        <span
          aria-hidden
          className="bg-accent text-on-accent tabular absolute -top-0.5 -right-0.5 min-w-4 rounded-full px-1 text-center text-[10px] leading-4 font-semibold"
        >
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
