import Link from "next/link";
import { SearchX } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page";

/** Also shown for anything not shared with this account, so its existence isn't revealed. */
export default function PortalNotFound() {
  return (
    <EmptyState
      titleAs="h1"
      icon={SearchX}
      title="Page not found"
      description="It may have moved, or it isn't shared with you."
      action={
        <Link href="/portal" className={buttonClasses("secondary")}>
          Back to the portal
        </Link>
      }
    />
  );
}
