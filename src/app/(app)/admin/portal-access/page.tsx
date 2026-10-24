import Link from "next/link";
import { requireActorOrRedirect } from "@/server/auth/session";
import { listAllPortalAccess, organisationHref } from "@/server/portal/access";
import { PORTAL_KIND_LABELS } from "@/server/portal/permissions";
import { formatDate } from "@/lib/format";
import { EmptyState, PageHeader, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata = { title: "Portal access" };

export default async function PortalAccessPage() {
  const actor = await requireActorOrRedirect();
  const { accounts, invitations } = await listAllPortalAccess(actor);
  const orgName = (r: (typeof accounts)[number] | (typeof invitations)[number]) =>
    r.client?.name ?? r.vendor?.name ?? r.crewMember?.name ?? "";

  return (
    <>
      <PageHeader
        title="Portal access"
        description="Everyone outside HMBL who can sign in to the portal, and open invitations. Invite and revoke from the client, vendor or freelancer's own page."
      />
      <Section title="Accounts">
        {accounts.length ? (
          <Table>
            <THead>
              <tr>
                <TH>Person</TH>
                <TH>For</TH>
                <TH>Status</TH>
                <TH>Since</TH>
              </tr>
            </THead>
            <TBody>
              {accounts.map((a) => {
                const href = organisationHref(a);
                return (
                  <TR key={a.id}>
                    <TD>
                      <p className="text-text">{a.user.name}</p>
                      <p className="text-muted text-xs">{a.user.email}</p>
                    </TD>
                    <TD>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Tag>{PORTAL_KIND_LABELS[a.kind]}</Tag>
                        {href ? (
                          <Link href={href} className="text-accent hover:underline">
                            {orgName(a)}
                          </Link>
                        ) : (
                          orgName(a)
                        )}
                      </span>
                    </TD>
                    <TD>
                      <StatusBadge status={a.status === "ACTIVE" ? "active" : "revoked"} />
                    </TD>
                    <TD className="text-secondary tabular">{formatDate(a.createdAt)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        ) : (
          <EmptyState title="Nobody outside HMBL has a portal account yet" />
        )}
      </Section>
      <Section title="Open invitations">
        {invitations.length ? (
          <Table>
            <THead>
              <tr>
                <TH>Person</TH>
                <TH>For</TH>
                <TH>Status</TH>
                <TH>Valid until</TH>
              </tr>
            </THead>
            <TBody>
              {invitations.map((i) => {
                const href = organisationHref(i);
                return (
                  <TR key={i.id}>
                    <TD>
                      <p className="text-text">{i.name}</p>
                      <p className="text-muted text-xs">{i.email}</p>
                    </TD>
                    <TD>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Tag>{PORTAL_KIND_LABELS[i.kind]}</Tag>
                        {href ? (
                          <Link href={href} className="text-accent hover:underline">
                            {orgName(i)}
                          </Link>
                        ) : (
                          orgName(i)
                        )}
                      </span>
                    </TD>
                    <TD>
                      <StatusBadge status={i.state === "pending" ? "invited" : "expired"} />
                    </TD>
                    <TD className="text-secondary tabular">{formatDate(i.expiresAt)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        ) : (
          <EmptyState title="No open invitations" />
        )}
      </Section>
    </>
  );
}
