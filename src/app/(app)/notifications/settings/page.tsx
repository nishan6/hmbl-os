import { requireActorOrRedirect } from "@/server/auth/session";
import { emailTransport } from "@/server/notifications/delivery";
import { notificationPreferences } from "@/server/notifications/service";
import { PageHeader } from "@/components/ui/page";
import { PreferencesForm } from "./preferences-form";

export const metadata = { title: "Notification settings" };

export default async function NotificationSettingsPage() {
  const actor = await requireActorOrRedirect();
  const prefs = await notificationPreferences(actor);
  return (
    <>
      <PageHeader
        title="Notification settings"
        description="Choose what you hear about. Turning a notification off never hides an approval: it still waits in Approvals."
        breadcrumbs={[{ label: "Notifications", href: "/notifications" }, { label: "Settings" }]}
      />
      <PreferencesForm prefs={prefs} emailReady={emailTransport() !== null} />
    </>
  );
}
