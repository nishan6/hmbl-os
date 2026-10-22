import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/session";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in · HMBL OS" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const { next } = await searchParams;
  const destination = safeRedirectPath(typeof next === "string" ? next : undefined);
  if (await getActor()) redirect(destination);

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold tracking-tight">Sign in to HMBL OS</h1>
        <p className="mt-1 text-sm opacity-70">Accounts are created by your administrator.</p>
        <SignInForm next={destination} />
      </div>
    </main>
  );
}
