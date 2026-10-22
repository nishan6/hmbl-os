import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getActor } from "@/server/auth/session";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { Brand } from "@/components/shell/brand";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const { next } = await searchParams;
  const destination = safeRedirectPath(typeof next === "string" ? next : undefined);
  if (await getActor()) redirect(destination);

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Brand href={null} />
        </div>
        <div className="border-separator bg-surface rounded-lg border p-6 shadow-md">
          <h1 className="text-text text-lg font-semibold tracking-tight">Sign in to HMBL OS</h1>
          <p className="text-secondary mt-1 text-sm">Accounts are created by your administrator.</p>
          <SignInForm next={destination} />
        </div>
      </div>
    </main>
  );
}
