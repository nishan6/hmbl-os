import { ShieldCheck, ShieldAlert } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { PageHeader, Panel, Section } from "@/components/ui/page";
import { Tag } from "@/components/ui/status";
import { TwoFactorSetup } from "@/components/account/two-factor-setup";
import { ManageTwoFactor } from "@/components/account/manage-two-factor";

export const metadata = { title: "Sign-in security" };

export default async function SecurityPage() {
  const actor = await requireActorOrRedirect();
  const enabled = actor.twoFactor?.enabled ?? false;
  const required = actor.twoFactor?.required ?? false;

  return (
    <>
      <PageHeader
        title="Sign-in security"
        breadcrumbs={[{ label: "Account" }, { label: "Sign-in security" }]}
      />
      <Section
        title="Two-factor sign-in"
        description="After your password, you also enter a code from an app on your phone."
      >
        <Panel className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {enabled ? (
              <Tag tone="success" className="gap-1">
                <ShieldCheck className="size-3" aria-hidden /> On
              </Tag>
            ) : (
              <Tag tone="warning" className="gap-1">
                <ShieldAlert className="size-3" aria-hidden /> Off
              </Tag>
            )}
            {required ? (
              <span className="text-secondary text-sm">Required for your role.</span>
            ) : null}
          </div>
          {enabled ? (
            <ManageTwoFactor canDisable={!required} />
          ) : (
            <TwoFactorSetup doneHref="/account/security" />
          )}
        </Panel>
      </Section>
    </>
  );
}
