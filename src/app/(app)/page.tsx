import Link from "next/link";
import { Building2, Hash, ScrollText, UserCog } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { getEntityContext } from "@/server/shell/entity-context";
import { PageHeader, Section } from "@/components/ui/page";
import { Tag } from "@/components/ui/status";

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
        description="Business modules arrive in later stages; nothing here is sample data."
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
