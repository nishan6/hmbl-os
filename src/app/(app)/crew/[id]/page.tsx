import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import {
  crewLinkOptions,
  crewSkills,
  getCrewMember,
  CREW_KINDS,
  CREW_RATE_TYPES,
} from "@/server/crew/members";
import { crewMemberAssignments } from "@/server/crew/assignments";
import { AppError } from "@/lib/errors";
import { certificationState, rateValidOn } from "@/lib/crew";
import { formatDate, formatMoney } from "@/lib/format";
import { ActionButton } from "@/components/ui/action-button";
import { DetailList, PageHeader, Panel, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ASSIGNMENT_STATUS } from "../../projects/_components/status";
import {
  addCertificationAction,
  addRateAction,
  addUnavailabilityAction,
  archiveCrewAction,
  endRateAction,
  removeCertificationAction,
  removeUnavailabilityAction,
  updateCrewAction,
} from "../actions";
import { CrewForm } from "../crew-form";
import { CertificationForm, EndRateForm, RateForm, UnavailabilityForm } from "./crew-forms";
import { RecordDocuments } from "../../documents/_components/record-documents";
import { PortalAccess } from "../../admin/portal-access/_components/portal-access";

export const metadata = { title: "Crew member" };

const date = (d: Date) => formatDate(d, "UTC");
const range = (a: Date, b: Date) =>
  a.getTime() === b.getTime() ? date(a) : `${date(a)} – ${date(b)}`;
const today = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

export default async function CrewMemberPage({ params }: PageProps<"/crew/[id]">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const m = await getCrewMember(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const edit = can(actor, "crew.edit");
  const bookings = await crewMemberAssignments(actor, id);
  const [links, skills] = edit
    ? await Promise.all([crewLinkOptions(actor, id), crewSkills(actor)])
    : [{ users: [], vendors: [] }, []];
  const archived = m.status === "ARCHIVED";
  const now = today();
  const s = (v: string | null) => v ?? "";
  const upcoming = m.unavailability.filter((u) => u.endDate >= now);

  return (
    <>
      <PageHeader
        title={m.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {CREW_KINDS[m.kind]}
            {m.baseCity ? <> · {m.baseCity}</> : null}
            <StatusBadge status={archived ? "archived" : "active"} />
            {m.isDemo ? <Tag tone="warning">Demo</Tag> : null}
          </span>
        }
        breadcrumbs={[{ label: "Crew", href: "/crew" }, { label: m.name }]}
        actions={
          can(actor, "crew.archive") ? (
            <ActionButton
              action={archiveCrewAction.bind(null, id)}
              fields={{ archived: archived ? "false" : "true" }}
              size="md"
              confirm={archived ? undefined : "Archive this crew member? Their history stays."}
            >
              {archived ? "Restore" : "Archive"}
            </ActionButton>
          ) : null
        }
      />

      <Section title="Details">
        {edit ? (
          <Panel>
            <CrewForm
              action={updateCrewAction.bind(null, id)}
              defaults={{
                name: m.name,
                kind: m.kind,
                userId: s(m.userId),
                vendorId: s(m.vendorId),
                email: s(m.email),
                phone: s(m.phone),
                baseCity: s(m.baseCity),
                preferredLocations: s(m.preferredLocations),
                skills: m.skills.join(", "),
                contractRef: s(m.contractRef),
                notes: s(m.notes),
                emergencyContactName: s(m.emergencyContactName),
                emergencyContactPhone: s(m.emergencyContactPhone),
                emergencyContactRelation: s(m.emergencyContactRelation),
              }}
              kinds={CREW_KINDS}
              users={links.users.map((u) => ({ id: u.id, label: `${u.name} (${u.email})` }))}
              vendors={links.vendors.map((v) => ({ id: v.id, label: v.name }))}
              skills={skills}
              sensitive={m.sensitive}
              submitLabel="Save changes"
            />
          </Panel>
        ) : (
          <DetailList
            items={[
              { label: "Works as", value: CREW_KINDS[m.kind] },
              { label: "Roles and skills", value: m.skills.join(", ") || "None recorded" },
              { label: "Email", value: m.email ?? "None" },
              { label: "Phone", value: m.phone ?? "None" },
              { label: "Will also work in", value: m.preferredLocations ?? "Not recorded" },
              ...(m.user ? [{ label: "Signs in as", value: m.user.email }] : []),
              ...(m.sensitive
                ? [
                    { label: "Paid through", value: m.vendor?.name ?? "Not set up" },
                    {
                      label: "Emergency contact",
                      value: m.emergencyContactName
                        ? `${m.emergencyContactName}${m.emergencyContactRelation ? ` (${m.emergencyContactRelation})` : ""}, ${m.emergencyContactPhone ?? "no phone"}`
                        : "None recorded",
                    },
                  ]
                : []),
            ]}
          />
        )}
      </Section>

      {m.sensitive ? (
        <Section
          title="Rates"
          description="Before tax. A rate for a role beats a rate for any role. Adding a rate ends the open one of the same kind."
        >
          {m.rates.length ? (
            <Table dense>
              <THead>
                <tr>
                  <TH>Type</TH>
                  <TH>Role</TH>
                  <TH align="right">Rate</TH>
                  <TH>In force</TH>
                  <TH>Status</TH>
                  {edit ? <TH>Actions</TH> : null}
                </tr>
              </THead>
              <TBody>
                {m.rates.map((r) => {
                  const current = rateValidOn(r, now);
                  return (
                    <TR key={r.id}>
                      <TD>{CREW_RATE_TYPES[r.type]}</TD>
                      <TD className="text-secondary">{r.role ?? "Any role"}</TD>
                      <TD align="right">{formatMoney(r.amountMinor, r.currency)}</TD>
                      <TD className="tabular whitespace-nowrap">
                        {date(r.validFrom)} – {r.validTo ? date(r.validTo) : "open"}
                      </TD>
                      <TD>
                        <StatusBadge
                          status={current ? "active" : r.validFrom > now ? "planning" : "closed"}
                        />
                      </TD>
                      {edit ? (
                        <TD>
                          {r.validTo ? null : <EndRateForm action={endRateAction} rateId={r.id} />}
                        </TD>
                      ) : null}
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          ) : (
            <p className="text-secondary text-sm">No rates yet.</p>
          )}
          {edit ? (
            <Panel className="mt-4">
              <h3 className="text-text mb-3 text-sm font-semibold">Add a rate</h3>
              <RateForm
                action={addRateAction.bind(null, id)}
                types={CREW_RATE_TYPES}
                defaults={{ currency: "INR", validFrom: now.toISOString().slice(0, 10) }}
              />
            </Panel>
          ) : null}
        </Section>
      ) : null}

      <Section title="Bookings" description="Projects they are proposed for or booked on.">
        {bookings.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Project</TH>
                <TH>Role</TH>
                <TH>Dates</TH>
                <TH>Status</TH>
              </tr>
            </THead>
            <TBody>
              {bookings.map((b) => (
                <TR key={b.id}>
                  <TD>
                    <Link
                      href={`/projects/${b.project.id}/resources/crew/${b.id}`}
                      className="text-accent hover:underline"
                    >
                      <span className="tabular">{b.project.number}</span> {b.project.name}
                    </Link>
                  </TD>
                  <TD>{b.role}</TD>
                  <TD className="tabular whitespace-nowrap">{range(b.startDate, b.endDate)}</TD>
                  <TD>
                    <StatusBadge status={ASSIGNMENT_STATUS[b.status]} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-secondary text-sm">No bookings yet.</p>
        )}
      </Section>

      <Section title="Certifications" description="Tickets and qualifications, with expiry dates.">
        {m.certifications.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Name</TH>
                <TH>Issued by</TH>
                <TH>Number</TH>
                <TH>Expires</TH>
                {edit ? <TH>Actions</TH> : null}
              </tr>
            </THead>
            <TBody>
              {m.certifications.map((c) => {
                const state = certificationState(c.expiresOn, now);
                return (
                  <TR key={c.id}>
                    <TD>{c.name}</TD>
                    <TD className="text-secondary">{c.issuer ?? "—"}</TD>
                    <TD className="tabular">{c.reference ?? "—"}</TD>
                    <TD className="tabular whitespace-nowrap">
                      {c.expiresOn ? date(c.expiresOn) : "No expiry"}{" "}
                      {state === "expired" ? (
                        <StatusBadge status="overdue" className="ml-1" />
                      ) : state === "expiring" ? (
                        <StatusBadge status="due" className="ml-1" />
                      ) : null}
                    </TD>
                    {edit ? (
                      <TD>
                        <ActionButton
                          action={removeCertificationAction}
                          fields={{ certificationId: c.id }}
                          confirm={`Remove ${c.name}?`}
                        >
                          Remove<span className="sr-only"> {c.name}</span>
                        </ActionButton>
                      </TD>
                    ) : null}
                  </TR>
                );
              })}
            </TBody>
          </Table>
        ) : (
          <p className="text-secondary text-sm">No certifications recorded.</p>
        )}
        {edit ? (
          <Panel className="mt-4">
            <h3 className="text-text mb-3 text-sm font-semibold">Add a certification</h3>
            <CertificationForm action={addCertificationAction.bind(null, id)} />
          </Panel>
        ) : null}
      </Section>

      <Section
        title="Time off"
        description="Days they can't work. Bookings on these days show as conflicts."
      >
        {upcoming.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Dates</TH>
                <TH>Reason</TH>
                {edit ? <TH>Actions</TH> : null}
              </tr>
            </THead>
            <TBody>
              {upcoming.map((u) => (
                <TR key={u.id}>
                  <TD className="tabular whitespace-nowrap">{range(u.startDate, u.endDate)}</TD>
                  <TD className="text-secondary">{u.reason ?? "—"}</TD>
                  {edit ? (
                    <TD>
                      <ActionButton
                        action={removeUnavailabilityAction}
                        fields={{ unavailabilityId: u.id }}
                        confirm="Remove this time off?"
                      >
                        Remove
                      </ActionButton>
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-secondary text-sm">No time off coming up.</p>
        )}
        {edit ? (
          <Panel className="mt-4">
            <h3 className="text-text mb-3 text-sm font-semibold">Add time off</h3>
            <UnavailabilityForm action={addUnavailabilityAction.bind(null, id)} />
          </Panel>
        ) : null}
      </Section>
      <RecordDocuments actor={actor} type="CREW_MEMBER" id={id} />
      {m.kind === "FREELANCER" ? <PortalAccess actor={actor} kind="FREELANCER" id={id} /> : null}
    </>
  );
}
