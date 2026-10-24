import type { PortalKind } from "@/generated/prisma/enums";
import type { Actor } from "@/server/permissions/authorize";
import { listPortalAccess } from "@/server/portal/access";
import { DEFAULT_PORTAL_PERMISSIONS, PORTAL_PERMISSIONS } from "@/server/portal/permissions";
import { AppError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { EmptyState, Panel, Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { CommandForm } from "../../../projects/[id]/changes/change-forms";
import {
  inviteAction,
  revokeAccountAction,
  revokeInvitationAction,
  updatePermissionsAction,
} from "../actions";
import { InviteForm, PermissionsForm } from "./invite-form";

const DESCRIPTIONS: Record<PortalKind, string> = {
  CLIENT:
    "Contacts at this client who may sign in to the portal. They see only what is shared with this client.",
  VENDOR:
    "People at this vendor who may sign in to the portal. They see only this vendor's orders and bills.",
  FREELANCER:
    "This freelancer's portal sign-in. They see only their own bookings and settlements, never internal records.",
};

/**
 * Who outside HMBL can sign in for this record, with invitations and
 * revocation. Renders nothing for people who can't see portal access.
 */
export async function PortalAccess({
  actor,
  kind,
  id,
  timeZone = "Asia/Kolkata",
}: {
  actor: Actor;
  kind: PortalKind;
  id: string;
  timeZone?: string;
}) {
  const view = await listPortalAccess(actor, { kind, id }).catch((error: unknown) => {
    if (error instanceof AppError) return null;
    throw error;
  });
  if (!view) return null;
  const { accounts, invitations, contacts, canInvite, canEdit, canRevoke } = view;
  const labels: Record<string, string> = PORTAL_PERMISSIONS[kind];
  const options = Object.entries(labels).map(([value, label]) => ({ value, label }));
  const open = invitations.filter((i) => i.state === "pending");
  const tz = timeZone;

  return (
    <Section title="Portal access" description={DESCRIPTIONS[kind]}>
      {accounts.length || open.length ? (
        <Table dense>
          <THead>
            <tr>
              <TH>Person</TH>
              <TH>Status</TH>
              <TH>May</TH>
              {canEdit || canRevoke ? <TH>Actions</TH> : null}
            </tr>
          </THead>
          <TBody>
            {accounts.map((a) => (
              <TR key={a.id}>
                <TD>
                  <p className="text-text">{a.user.name}</p>
                  <p className="text-muted text-xs">
                    {a.user.email}
                    {a.contact ? ` · contact: ${a.contact.name}` : ""}
                  </p>
                </TD>
                <TD>
                  <StatusBadge status={a.status === "ACTIVE" ? "active" : "revoked"} />
                  {a.revokedAt ? (
                    <p className="text-muted text-xs">
                      {a.revokedBy?.name} · {formatDate(a.revokedAt, tz)} · {a.revokeReason}
                    </p>
                  ) : null}
                </TD>
                <TD className="text-secondary text-xs">
                  {a.permissions.map((p) => labels[p] ?? p).join("; ")}
                </TD>
                {canEdit || canRevoke ? (
                  <TD>
                    {a.status === "ACTIVE" ? (
                      <div className="flex flex-col items-start gap-1">
                        {canEdit ? (
                          <details className="text-sm">
                            <summary className="text-accent cursor-pointer text-xs">
                              Change access<span className="sr-only"> for {a.user.name}</span>
                            </summary>
                            <div className="w-80 py-2">
                              <PermissionsForm
                                action={updatePermissionsAction.bind(null, a.id)}
                                permissions={options}
                                current={a.permissions}
                                label={`What ${a.user.name} may do`}
                              />
                            </div>
                          </details>
                        ) : null}
                        {canRevoke ? (
                          <details className="text-sm">
                            <summary className="text-secondary hover:text-text cursor-pointer text-xs">
                              Revoke<span className="sr-only"> {a.user.name}</span>
                            </summary>
                            <div className="w-72 py-2">
                              <CommandForm
                                action={revokeAccountAction.bind(null, a.id)}
                                description="Signs them out now. They can't sign in again unless invited afresh."
                                label="Reason"
                                required
                                buttons={[
                                  { command: "revoke", label: "Revoke access", destructive: true },
                                ]}
                              />
                            </div>
                          </details>
                        ) : null}
                      </div>
                    ) : null}
                  </TD>
                ) : null}
              </TR>
            ))}
            {open.map((i) => (
              <TR key={i.id}>
                <TD>
                  <p className="text-text">{i.name}</p>
                  <p className="text-muted text-xs">
                    {i.email}
                    {i.contact ? ` · contact: ${i.contact.name}` : ""}
                  </p>
                </TD>
                <TD>
                  <StatusBadge status="invited" />
                  <p className="text-muted text-xs">
                    by {i.createdBy.name} · until {formatDate(i.expiresAt, tz)}
                  </p>
                </TD>
                <TD className="text-secondary text-xs">
                  {i.permissions.map((p) => labels[p] ?? p).join("; ")}
                </TD>
                {canEdit || canRevoke ? (
                  <TD>
                    {canRevoke ? (
                      <CommandForm
                        action={revokeInvitationAction.bind(null, i.id)}
                        buttons={[{ command: "revoke", label: "Revoke invitation" }]}
                      />
                    ) : null}
                  </TD>
                ) : null}
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState title="Nobody here can sign in to the portal" />
      )}
      {canInvite ? (
        <Panel className="mt-4">
          <h3 className="text-text mb-3 text-sm font-semibold">Invite to the portal</h3>
          <InviteForm
            action={inviteAction.bind(null, kind, id)}
            permissions={options}
            defaults={DEFAULT_PORTAL_PERMISSIONS[kind]}
            contacts={kind === "CLIENT" ? contacts : undefined}
          />
        </Panel>
      ) : null}
    </Section>
  );
}
