import { Share2 } from "lucide-react";
import type { PortalShareKind } from "@/generated/prisma/enums";
import type { Actor } from "@/server/permissions/authorize";
import { sharingFor } from "@/server/portal/sharing";
import { AppError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { ActionButton } from "@/components/ui/action-button";
import { Panel, Section } from "@/components/ui/page";
import { Tag } from "@/components/ui/status";
import { shareAction, stopSharingAction } from "../sharing-actions";

const WHAT: Record<Exclude<PortalShareKind, "DOCUMENT">, string> = {
  PROJECT:
    "The client's portal users see this project's name, dates, venue, status and payment milestones, and can send you information about it. Never costs, budgets, crew or notes.",
  QUOTE:
    "The client's portal users see the latest issued version and can accept or decline it there. Never costs, margins or internal notes.",
};

/** Whether a project or quotation is shared in the client portal, with the switch. */
export async function PortalShare({
  actor,
  kind,
  id,
  timeZone = "Asia/Kolkata",
}: {
  actor: Actor;
  kind: Exclude<PortalShareKind, "DOCUMENT">;
  id: string;
  timeZone?: string;
}) {
  const view = await sharingFor(actor, { kind, id }).catch((error: unknown) => {
    if (error instanceof AppError) return null;
    throw error;
  });
  if (!view) return null;
  const { share, accounts, canShare, blocked } = view;
  return (
    <Section title="Client portal">
      <Panel className="flex flex-col gap-3 text-sm">
        <p className="flex flex-wrap items-center gap-1.5">
          {share ? (
            <Tag tone="info">
              <Share2 aria-hidden className="size-3" />
              Shared with the client
            </Tag>
          ) : (
            <Tag>Not shared</Tag>
          )}
          {share ? (
            <span className="text-muted text-xs">
              {share.sharedBy.name} · {formatDate(share.createdAt, timeZone)}
            </span>
          ) : null}
        </p>
        <p className="text-secondary">{WHAT[kind]}</p>
        <p className="text-muted text-xs">
          {accounts
            ? `${accounts} person${accounts === 1 ? "" : "s"} at the client can sign in to the portal.`
            : "Nobody at the client can sign in to the portal yet. Invite them from the client's page."}
        </p>
        {canShare ? (
          share ? (
            <ActionButton
              action={stopSharingAction.bind(null, kind, id)}
              fields={{}}
              variant="secondary"
              confirm="The client will no longer see this in the portal."
            >
              Stop sharing
            </ActionButton>
          ) : blocked ? (
            <p className="text-secondary">{blocked}</p>
          ) : (
            <ActionButton action={shareAction.bind(null, kind, id)} fields={{}} variant="secondary">
              Share with the client
            </ActionButton>
          )
        ) : null}
      </Panel>
    </Section>
  );
}
