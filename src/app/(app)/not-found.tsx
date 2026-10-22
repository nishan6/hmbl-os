import Link from "next/link";
import { SearchX } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page";

/** Also shown for records outside the user's entities, so their existence isn't revealed. */
export default function AppNotFound() {
  return (
    <EmptyState
      titleAs="h1"
      icon={SearchX}
      title="Page not found"
      description="It may have moved, or you may not have access to it."
      action={
        <Link href="/" className={buttonClasses("secondary")}>
          Go home
        </Link>
      }
    />
  );
}
