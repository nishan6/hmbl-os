import { requireActorOrRedirect } from "@/server/auth/session";
import { SignOutButton } from "@/components/sign-out-button";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const actor = await requireActorOrRedirect();
  return (
    <div className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-black/10 px-6 py-3 dark:border-white/10">
        <span className="font-semibold tracking-tight">HMBL OS</span>
        <div className="flex items-center gap-4 text-sm">
          <span>{actor.name}</span>
          <SignOutButton />
        </div>
      </header>
      <main className="flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
