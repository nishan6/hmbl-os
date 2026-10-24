import type { Metadata } from "next";
import { invitationForToken } from "@/server/portal/accept";
import { PORTAL_KIND_LABELS } from "@/server/portal/permissions";
import { formatDate } from "@/lib/format";
import { Brand } from "@/components/shell/brand";
import { Alert } from "@/components/ui/page";
import { AcceptForm } from "./accept-form";

export const metadata: Metadata = { title: "Portal invitation", robots: { index: false } };

const UNUSABLE = {
  expired: "This invitation has expired.",
  accepted: "This invitation has already been used. Sign in with the account it created.",
  revoked: "This invitation has been withdrawn.",
} as const;

export default async function InvitationPage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const invitation = await invitationForToken(token);

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Brand href={null} />
        </div>
        <div className="border-separator bg-surface rounded-lg border p-6 shadow-md">
          {!invitation ? (
            <>
              <h1 className="text-text text-lg font-semibold tracking-tight">
                This link isn&apos;t valid
              </h1>
              <p className="text-secondary mt-1 text-sm">
                Check you copied all of it, or ask whoever invited you for a new one.
              </p>
            </>
          ) : invitation.state !== "pending" ? (
            <>
              <h1 className="text-text text-lg font-semibold tracking-tight">Portal invitation</h1>
              <Alert tone="warning" title={UNUSABLE[invitation.state]}>
                {invitation.state === "accepted" ? (
                  <a href="/sign-in?next=/portal" className="text-accent underline">
                    Sign in
                  </a>
                ) : (
                  "Ask whoever invited you for a new link."
                )}
              </Alert>
            </>
          ) : (
            <>
              <h1 className="text-text text-lg font-semibold tracking-tight">
                {invitation.invitedBy} invited you to the HMBL portal
              </h1>
              <p className="text-secondary mt-1 text-sm">
                {PORTAL_KIND_LABELS[invitation.kind]} access for{" "}
                <strong className="text-text font-medium">{invitation.organisation}</strong>. This
                link works until {formatDate(invitation.expiresAt, "UTC")}.
              </p>
              <div className="mt-4">
                <p className="text-text text-sm font-medium">You will be able to</p>
                <ul className="text-secondary mt-1 list-disc pl-5 text-sm">
                  {invitation.permissions.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
                <p className="text-muted mt-2 text-xs">
                  Only what HMBL shares with {invitation.organisation}. Nothing else in HMBL&apos;s
                  systems is visible to portal accounts.
                </p>
              </div>
              <AcceptForm token={token} name={invitation.name} />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
