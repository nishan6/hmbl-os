import type { Metadata } from "next";
import { requirePortalActorOrRedirect, type PortalActor } from "@/server/portal/session";
import { PORTAL_KIND_LABELS } from "@/server/portal/permissions";
import { Brand } from "@/components/shell/brand";
import { PortalNav, type PortalNavItem } from "@/components/portal/portal-nav";
import { SignOutButton } from "@/components/portal/sign-out-button";
import { Tag } from "@/components/ui/status";

export const metadata: Metadata = {
  title: { default: "Portal", template: "%s · HMBL portal" },
  robots: { index: false },
};

/** Sections this account has, by what it may do. */
function navFor(actor: PortalActor): PortalNavItem[] {
  const has = (p: string) => actor.permissions.has(p);
  const items: (PortalNavItem | false)[] =
    actor.kind === "CLIENT"
      ? [
          has("projects.view") && { href: "/portal/projects", label: "Projects" },
          has("quotes.respond") && { href: "/portal/quotes", label: "Quotations" },
          has("invoices.view") && { href: "/portal/invoices", label: "Invoices" },
          has("documents.view") && { href: "/portal/documents", label: "Documents" },
        ]
      : [];
  return [{ href: "/portal", label: "Home" }, ...items.filter((i) => i !== false)];
}

/**
 * The portal shell: for people outside HMBL. Deliberately separate from the
 * HMBL OS shell, with none of its navigation, and every page checks the
 * portal account itself (docs/portal.md).
 */
export default async function PortalLayout({ children }: LayoutProps<"/portal">) {
  const actor = await requirePortalActorOrRedirect();
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <a
        href="#main"
        className="bg-elevated sr-only z-50 rounded-md px-3 py-2 shadow-md focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <header className="h-topbar border-separator bg-bg/85 sticky top-0 z-30 flex items-center gap-3 border-b px-3 backdrop-blur sm:px-4">
        <Brand href="/portal" />
        <span className="text-secondary hidden items-center gap-1.5 text-sm sm:flex">
          <Tag>{PORTAL_KIND_LABELS[actor.kind]}</Tag>
          {actor.organisation}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-secondary hidden text-sm md:inline">{actor.name}</span>
          <SignOutButton />
        </div>
      </header>
      <PortalNav items={navFor(actor)} />
      <main id="main" className="max-w-content mx-auto w-full flex-1 px-4 py-6 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
