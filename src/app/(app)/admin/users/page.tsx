import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { INVITE_DAYS, listOpenLinks } from "@/server/users/links";
import { listUsers, roleOptions } from "@/server/users/service";
import { formatDateTime } from "@/lib/format";
import { EmptyState, PageHeader, Panel, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CommandForm } from "../../projects/[id]/changes/change-forms";
import { inviteStaffAction, revokeLinkAction } from "./actions";
import { InviteStaffForm } from "./_components/forms";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "users.view")) notFound();
  const [users, links, options] = await Promise.all([
    listUsers(actor),
    listOpenLinks(actor),
    roleOptions(actor),
  ]);
  const canInvite = can(actor, "users.create") && can(actor, "users.configure");
  const canWithdraw = can(actor, "users.configure");

  return (
    <>
      <PageHeader
        title="Users"
        description="Everyone who can sign in to HMBL OS, and the roles they hold. Roles can be limited to one legal entity."
        breadcrumbs={[{ label: "Administration" }, { label: "Users" }]}
      />
      <Table>
        <THead>
          <tr>
            <TH>Name</TH>
            <TH>Email</TH>
            <TH>Roles</TH>
            <TH>Status</TH>
          </tr>
        </THead>
        <TBody>
          {users.map((u) => (
            <TR key={u.id}>
              <TD className="font-medium">
                <Link href={`/admin/users/${u.id}`} className="text-accent hover:underline">
                  {u.name}
                </Link>
              </TD>
              <TD className="text-secondary">{u.email}</TD>
              <TD>
                <span className="flex flex-wrap gap-1">
                  {u.roles.length
                    ? u.roles.map((r, i) => (
                        <Tag key={i}>
                          {r.role.name}
                          {r.legalEntity ? ` · ${r.legalEntity.code}` : ""}
                        </Tag>
                      ))
                    : "—"}
                </span>
              </TD>
              <TD>
                <StatusBadge status={u.status === "ACTIVE" ? "active" : "disabled"} />
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>

      <Section
        title="Open links"
        description="Invitations and password links not used yet. Each works once, for the address it names."
      >
        {links.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Person</TH>
                <TH>For</TH>
                <TH>Made</TH>
                {canWithdraw ? <TH>Actions</TH> : null}
              </tr>
            </THead>
            <TBody>
              {links.map((l) => (
                <TR key={l.id}>
                  <TD>
                    <p className="text-text">{l.name}</p>
                    <p className="text-muted text-xs">{l.email}</p>
                  </TD>
                  <TD>
                    <StatusBadge
                      status="invited"
                      label={l.purpose === "INVITE" ? "Invited" : "New password"}
                    />
                    <p className="text-muted text-xs">
                      {l.purpose === "INVITE"
                        ? l.roleLabels.join(", ")
                        : l.resetTwoFactor
                          ? "Password and two-factor"
                          : "Password"}
                    </p>
                  </TD>
                  <TD className="text-secondary text-xs">
                    by {l.createdBy.name} · until {formatDateTime(l.expiresAt)}
                  </TD>
                  {canWithdraw ? (
                    <TD>
                      <CommandForm
                        action={revokeLinkAction.bind(null, l.id)}
                        buttons={[{ command: "revoke", label: "Withdraw" }]}
                      />
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState title="No open invitations or password links" />
        )}
        {canInvite ? (
          <Panel className="mt-4">
            <h3 className="text-text mb-3 text-sm font-semibold">Invite someone to HMBL OS</h3>
            <InviteStaffForm action={inviteStaffAction} options={options} days={INVITE_DAYS} />
          </Panel>
        ) : null}
      </Section>
    </>
  );
}
