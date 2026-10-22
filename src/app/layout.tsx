import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "HMBL OS", template: "%s · HMBL OS" },
  description: "The operating system for HMBL Group.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0f11" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The theme is applied on the server, so the first paint is already right.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en-IN" data-theme={theme === "system" ? undefined : theme} className="h-full">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
