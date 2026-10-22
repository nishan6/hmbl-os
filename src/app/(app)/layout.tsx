import { cookies } from "next/headers";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { getEntityContext } from "@/server/shell/entity-context";
import { NAV } from "@/components/shell/nav-items";
import { SidebarNav } from "@/components/shell/sidebar";
import { MobileNav } from "@/components/shell/mobile-nav";
import { EntitySwitcher } from "@/components/shell/entity-switcher";
import { UserMenu } from "@/components/shell/user-menu";
import { Brand } from "@/components/shell/brand";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import { TwoFactorRequired } from "@/components/account/two-factor-required";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const actor = await requireActorOrRedirect();
  // Until this is done the user holds no permissions, so nothing else is shown.
  if (actor.twoFactor?.setupRequired) return <TwoFactorRequired name={actor.name} />;
  const [{ entities, selectedId }, cookieStore] = await Promise.all([
    getEntityContext(actor),
    cookies(),
  ]);
  const theme = parseTheme(cookieStore.get(THEME_COOKIE)?.value);
  // Decided on the server: the client only renders what it's given.
  const visible = NAV.flatMap((g) => g.items)
    .filter((item) => !item.permission || can(actor, item.permission))
    .map((item) => item.label);

  return (
    <div className="flex min-h-full flex-1">
      <a
        href="#main"
        className="bg-elevated sr-only z-50 rounded-md px-3 py-2 shadow-md focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      <aside className="w-sidebar border-separator bg-sidebar sticky top-0 hidden h-dvh shrink-0 flex-col overflow-y-auto border-r lg:flex">
        <div className="h-topbar flex items-center px-3">
          <Brand />
        </div>
        <SidebarNav visible={visible} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="h-topbar border-separator bg-bg/85 sticky top-0 z-30 flex items-center gap-2 border-b px-3 backdrop-blur sm:px-4">
          <MobileNav visible={visible} />
          <div className="lg:hidden">
            <Brand />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <EntitySwitcher entities={entities} selectedId={selectedId} />
            <UserMenu name={actor.name} email={actor.email} theme={theme} />
          </div>
        </header>
        <main id="main" className="max-w-content mx-auto w-full flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
