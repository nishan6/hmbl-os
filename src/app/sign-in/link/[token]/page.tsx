import type { Metadata } from "next";
import { accountLinkForToken } from "@/server/users/links";
import { formatDateTime } from "@/lib/format";
import { Brand } from "@/components/shell/brand";
import { Alert } from "@/components/ui/page";
import { LinkForm } from "./link-form";

export const metadata: Metadata = { title: "Set your password", robots: { index: false } };

const UNUSABLE = {
  expired: "This link has expired.",
  used: "This link has already been used.",
  revoked: "This link has been withdrawn.",
} as const;

/** Joining HMBL OS, or setting a new password, from a link an administrator made. */
export default async function AccountLinkPage({ params }: PageProps<"/sign-in/link/[token]">) {
  const { token } = await params;
  const link = await accountLinkForToken(token);
  const invite = link?.purpose === "INVITE";

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Brand href={null} />
        </div>
        <div className="border-separator bg-surface rounded-lg border p-6 shadow-md">
          {!link ? (
            <>
              <h1 className="text-text text-lg font-semibold tracking-tight">
                This link isn&apos;t valid
              </h1>
              <p className="text-secondary mt-1 text-sm">
                Check you copied all of it, or ask your administrator for a new one.
              </p>
            </>
          ) : link.state !== "pending" ? (
            <>
              <h1 className="text-text text-lg font-semibold tracking-tight">
                {invite ? "Invitation to HMBL OS" : "Set a new password"}
              </h1>
              <Alert tone="warning" title={UNUSABLE[link.state]}>
                {link.state === "used" ? (
                  <a href="/sign-in" className="text-accent underline">
                    Sign in
                  </a>
                ) : (
                  "Ask your administrator for a new link."
                )}
              </Alert>
            </>
          ) : (
            <>
              <h1 className="text-text text-lg font-semibold tracking-tight">
                {invite
                  ? `${link.createdBy} invited you to HMBL OS`
                  : `Set a new password, ${link.name}`}
              </h1>
              <p className="text-secondary mt-1 text-sm">
                {invite ? `As ${link.roles.join(", ")}. ` : ""}This link works once, until{" "}
                {formatDateTime(link.expiresAt)}.
                {!invite && link.resetTwoFactor
                  ? " Your authenticator app is removed too: set it up again after you sign in."
                  : ""}
                {!invite ? " You'll be signed out everywhere else." : ""}
              </p>
              <LinkForm token={token} name={link.name} invite={invite} />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
