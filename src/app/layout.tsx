import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HMBL OS",
  description: "The operating system for HMBL Group.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
