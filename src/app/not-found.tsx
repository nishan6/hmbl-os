import Link from "next/link";
import { SearchX } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page";
import { Brand } from "@/components/shell/brand";

/** Unmatched URLs. Pages inside the app use (app)/not-found.tsx with the shell around it. */
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-8 px-4 py-16">
      <div className="flex justify-center">
        <Brand href={null} />
      </div>
      <EmptyState
        titleAs="h1"
        icon={SearchX}
        title="Page not found"
        description="Check the address, or start again from home."
        action={
          <Link href="/" className={buttonClasses("secondary")}>
            Go home
          </Link>
        }
      />
    </main>
  );
}
