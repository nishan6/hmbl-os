import { notFound } from "next/navigation";
import { getMyDetails } from "@/server/portal/profile";
import { requirePortalActorOrRedirect } from "@/server/portal/session";
import { formatDateTime } from "@/lib/format";
import { PageHeader, Panel, Section } from "@/components/ui/page";
import { orNotFound } from "../_lib/guard";
import { DetailsForm, RequestForm } from "./details-forms";

export const metadata = { title: "Your details" };

const VENDOR_FIELDS = [
  ["email", "Email"],
  ["phone", "Phone"],
  ["addressLine1", "Address"],
  ["addressLine2", "Address line 2"],
  ["city", "City"],
  ["postalCode", "Postal code"],
] as const;

const CREW_FIELDS = [
  ["email", "Email"],
  ["phone", "Phone"],
  ["baseCity", "Where you are based"],
  ["preferredLocations", "Other places you will work"],
  ["emergencyContactName", "Emergency contact"],
  ["emergencyContactPhone", "Emergency contact phone"],
  ["emergencyContactRelation", "Their relationship to you"],
] as const;

export default async function PortalDetailsPage() {
  const actor = await requirePortalActorOrRedirect();
  if (actor.kind === "CLIENT") notFound();
  const details = await orNotFound(getMyDetails(actor));
  const fields = details.kind === "VENDOR" ? VENDOR_FIELDS : CREW_FIELDS;
  const defaults = Object.fromEntries(fields.map(([k]) => [k, details.values[k] ?? ""]));
  return (
    <>
      <PageHeader title="Your details" description={`What HMBL holds for ${actor.organisation}.`} />
      <div className="grid gap-x-8 lg:grid-cols-2">
        <Section title="Contact details" description="Changes are saved straight away.">
          <Panel>
            <DetailsForm
              fields={fields.map(([name, label]) => ({ name, label }))}
              defaults={defaults}
            />
          </Panel>
        </Section>
        <div className="min-w-0">
          <Section
            title={
              details.kind === "VENDOR"
                ? "Tax, bank or compliance changes"
                : "Certification, tax or bank changes"
            }
            description="For your safety these are never changed from the portal. Tell HMBL what changed; they check it and update your record."
          >
            <Panel>
              <RequestForm />
            </Panel>
          </Section>
          {details.requests.length ? (
            <Section title="What you asked HMBL to change">
              <ol className="flex flex-col gap-3 text-sm">
                {details.requests.map((r) => (
                  <li key={r.id}>
                    <p className="text-muted text-xs">{formatDateTime(r.createdAt)}</p>
                    <p className="text-secondary whitespace-pre-line">{r.details}</p>
                  </li>
                ))}
              </ol>
            </Section>
          ) : null}
        </div>
      </div>
    </>
  );
}
