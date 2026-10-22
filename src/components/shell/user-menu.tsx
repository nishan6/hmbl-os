"use client";

import { useTransition } from "react";
import { DropdownMenu } from "radix-ui";
import Link from "next/link";
import { Check, LogOut, Monitor, Moon, ShieldCheck, Sun } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { setThemePreference } from "@/app/(app)/actions";
import type { Theme } from "@/lib/theme";
import { cn } from "@/lib/cn";

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "system", label: "Match system", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

const item =
  "flex h-8 cursor-default items-center gap-2 rounded-sm px-2 text-base text-text outline-none select-none " +
  "data-highlighted:bg-hover data-disabled:text-disabled [&_svg]:size-4";

function applyTheme(theme: Theme) {
  // Instant feedback; the cookie set by the server action keeps it on reload.
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export function UserMenu({ name, email, theme }: { name: string; email: string; theme: Theme }) {
  const [, startTransition] = useTransition();
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="bg-accent-soft text-accent flex size-8 items-center justify-center rounded-full text-xs font-semibold hover:opacity-90">
        {/* Initials are decoration; the accessible name spells out whose account it is. */}
        <span aria-hidden>{initials}</span>
        <span className="sr-only">Account: {name}</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="border-separator bg-elevated z-50 min-w-56 rounded-lg border p-1 shadow-lg"
        >
          <div className="px-2 py-1.5">
            <p className="text-text text-base font-medium">{name}</p>
            <p className="text-muted truncate text-xs">{email}</p>
          </div>
          <DropdownMenu.Separator className="bg-separator my-1 h-px" />
          <DropdownMenu.Label className="text-muted px-2 py-1 text-xs">
            Appearance
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={theme}
            onValueChange={(value) => {
              applyTheme(value as Theme);
              startTransition(() => setThemePreference(value));
            }}
          >
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
              <DropdownMenu.RadioItem key={value} value={value} className={item}>
                <Icon aria-hidden />
                {label}
                <DropdownMenu.ItemIndicator className="ml-auto">
                  <Check aria-hidden />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="bg-separator my-1 h-px" />
          <DropdownMenu.Item asChild className={item}>
            <Link href="/account/security">
              <ShieldCheck aria-hidden />
              Sign-in security
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className={cn(item)}
            onSelect={async () => {
              await authClient.signOut();
              // A full load drops every page the router cached while signed in.
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination
              window.location.assign("/sign-in");
            }}
          >
            <LogOut aria-hidden />
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
