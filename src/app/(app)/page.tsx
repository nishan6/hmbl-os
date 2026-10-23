import Link from "next/link";
import { Building2, Hash, ScrollText, UserCog } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { getEntityContext } from "@/server/shell/entity-context";
import { listMyFollowUps } from "@/server/crm/activities";
import { formatDateTime } from "@/lib/format";
import { PageHeader, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";

const SHORTCUTS = [
  {
    href: "/admin/organisation",
    label: "Organisation",
    description: "Legal entities, tax registrations, cost centres and locations",
    icon: Building2,
    permission: "organisation.view",
  },
  {
    href: "/admin/numbering",
    label: "Numbering",
    description: "Document number formats per entity",
    icon: Hash,
    permission: "organisation.view",
  },
  {
    href: "/admin/users",
    label: "Users",
    description: "People, roles and access",
    icon: UserCog,
    permission: "users.view",
  },
  {
    href: "/admin/audit",
    label: "Audit log",
    description: "Who changed what, and when",
    icon: ScrollText,
    permission: "audit.view",
  },
] as const;

export default async function HomePage() {
  const actor = await requireActorOrRedirect();
  const { entities, selectedId } = await getEntityContext(actor);
  const selected = entities.find((e) => e.id === selectedId);
  const shortcuts = SHORTCUTS.filter((s) => can(actor, s.permission));
  const roles = [...new Set(actor.grants.map((g) => g.roleKey))];
  const followUps = can(actor, "crm.view") ? await listMyFollowUps(actor) : [];
  const now = new Date();

  return (
    <>
      <PageHeader
        title={`Good to see you, ${actor.name.split(" ")[0]}`}
        description={
          selected
            ? `Working in ${selected.name}.`
            : entities.length > 1
              ? `Working across ${entities.length} legal entities.`
              : undefined
        }
      />
      <Section
        title="Your access"
        description="Your roles decide which modules and legal entities you can open."
      >
        <div className="flex flex-wrap gap-1.5">
          {roles.length ? (
            roles.map((r) => <Tag key={r}>{r.replace("_", " ")}</Tag>)
          ) : (
            <p className="text-secondary text-base">
              You have no roles yet. Ask an administrator for access.
            </p>
          )}
        </div>
      </Section>
      {followUps.length ? (
        <Section
          title="Your follow-ups"
          description="Open follow-ups assigned to you, soonest first."
        >
          <ul className="flex flex-col gap-2">
            {followUps.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center gap-2 text-base">
                <StatusBadge status={f.dueAt && f.dueAt < now ? "overdue" : "due"} />
                <Link
                  href={
                    f.opportunity
                      ? `/crm/opportunities/${f.opportunity.id}`
                      : `/crm/clients/${f.client.id}`
                  }
                  className="text-accent hover:underline"
                >
                  {f.subject}
                </Link>
                <span className="text-secondary text-sm">
                  {f.client.name}
                  {f.dueAt ? ` · ${formatDateTime(f.dueAt)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
      {shortcuts.length ? (
        <Section title="Administration">
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {shortcuts.map(({ href, label, description, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="border-separator bg-surface hover:border-border-strong flex h-full flex-col gap-1 rounded-lg border p-4 shadow-sm transition-colors"
                >
                  <Icon className="text-accent size-4" aria-hidden />
                  <span className="text-text text-base font-medium">{label}</span>
                  <span className="text-secondary text-sm">{description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}
