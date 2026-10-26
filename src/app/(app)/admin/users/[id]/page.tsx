import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { RESET_HOURS } from "@/server/users/links";
import { getUser, roleOptions } from "@/server/users/service";
import { AppError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { DetailList, EmptyState, PageHeader, Panel, Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CommandForm } from "../../../projects/[id]/changes/change-forms";
import {
  grantRoleAction,
  passwordLinkAction,
  revokeRoleAction,
  setUserEnabledAction,
} from "../actions";
import { GrantRoleForm, PasswordLinkForm } from "../_components/forms";

export const metadata = { title: "User" };

export default async function UserPage({ params }: PageProps<"/admin/users/[id]">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  if (!can(actor, "users.view")) notFound();
  const user = await getUser(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const options = await roleOptions(actor);
  const self = user.id === actor.id;
  const active = user.status === "ACTIVE";
  const canConfigure = can(actor, "users.configure");
  const canArchive = can(actor, "users.archive") && !self;

  return (
    <>
      <PageHeader
        title={user.name}
        description={user.email}
        breadcrumbs={[
          { label: "Administration" },
          { label: "Users", href: "/admin/users" },
          { label: user.name },
        ]}
      />
      <Panel>
        <DetailList
          items={[
            {
              label: "Status",
              value: <StatusBadge status={active ? "active" : "disabled"} />,
            },
            {
              label: "Two-factor",
              value: (
                <StatusBadge
                  status={user.twoFactorEnabled ? "active" : "disabled"}
                  label={user.twoFactorEnabled ? "On" : "Off"}
                />
              ),
            },
            { label: "Since", value: formatDate(user.createdAt) },
          ]}
        />
      </Panel>

      <Section
        title="Roles"
        description="What they may do. A role limited to one legal entity applies only to its records."
      >
        {user.roles.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Role</TH>
                <TH>For</TH>
                <TH>Granted</TH>
                {canConfigure ? <TH>Actions</TH> : null}
              </tr>
            </THead>
            <TBody>
              {user.roles.map((r) => (
                <TR key={r.id}>
                  <TD className="text-text">{r.role.name}</TD>
                  <TD className="text-secondary">
                    {r.legalEntity
                      ? `${r.legalEntity.code} · ${r.legalEntity.legalName}`
                      : "Every legal entity"}
                  </TD>
                  <TD className="text-secondary text-xs">
                    {formatDate(r.createdAt)}
                    {r.grantedBy ? ` by ${r.grantedBy.name}` : ""}
                  </TD>
                  {canConfigure ? (
                    <TD>
                      <CommandForm
                        action={revokeRoleAction.bind(null, user.id, r.role.key, r.legalEntityId)}
                        buttons={[{ command: "revoke", label: "Remove" }]}
                      />
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState
            title="No roles"
            description="They can sign in but can't see or do anything."
          />
        )}
        {canConfigure && active ? (
          <Panel className="mt-4">
            <h3 className="text-text mb-3 text-sm font-semibold">Grant a role</h3>
            <GrantRoleForm action={grantRoleAction.bind(null, user.id)} options={options} />
          </Panel>
        ) : null}
      </Section>

      {canConfigure && active && !self ? (
        <Section
          title="Forgotten password or lost phone"
          description="HMBL OS sends no email, so you make a link and send it to them yourself. They type their email address and choose a new password."
        >
          <Panel>
            <PasswordLinkForm action={passwordLinkAction.bind(null, user.id)} hours={RESET_HOURS} />
          </Panel>
        </Section>
      ) : null}

      {canArchive ? (
        <Section title={active ? "Disable the account" : "Enable the account"}>
          <Panel>
            <CommandForm
              action={setUserEnabledAction.bind(null, user.id, !active)}
              description={
                active
                  ? "For someone who has left or shouldn't sign in any more. Signs them out everywhere at once. Their records and history stay."
                  : "Lets them sign in again with the roles listed above."
              }
              buttons={[
                active
                  ? { command: "disable", label: "Disable account", destructive: true }
                  : { command: "enable", label: "Enable account", primary: true },
              ]}
            />
          </Panel>
        </Section>
      ) : null}
    </>
  );
}
