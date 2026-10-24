import { ALL_PERMISSIONS, MODULES, type Module, type Permission } from "./catalog";

/**
 * DEFAULT ROLES — configurable starting points, not approved HMBL Group policy.
 * They are created once if missing and can then be edited by an administrator.
 * See docs/decisions.md ("Roles and permissions").
 */
export type RoleDefinition = {
  key: string;
  name: string;
  description: string;
  permissions: Permission[];
};

function all(module: Module, except: string[] = []): Permission[] {
  return MODULES[module].actions
    .filter((action) => !except.includes(action))
    .map((action) => `${module}.${action}` as Permission);
}

function only(module: Module, actions: string[]): Permission[] {
  return all(module).filter((p) => actions.includes(p.split(".")[1]!));
}

const viewEverything = ALL_PERMISSIONS.filter((p) => p.endsWith(".view"));

const unique = (permissions: Permission[]) => [...new Set(permissions)];

export const DEFAULT_ROLES: RoleDefinition[] = (
  [
    {
      key: "owner",
      name: "Owner / Director",
      description: "Every permission, including sensitive financial data.",
      permissions: [...ALL_PERMISSIONS],
    },
    {
      key: "administrator",
      name: "Administrator",
      description: "Manages users, roles and organisation settings. Can view, not transact.",
      permissions: [
        ...viewEverything,
        ...all("users"),
        ...all("organisation"),
        ...all("audit"),
        ...all("portal"),
      ],
    },
    {
      key: "finance",
      name: "Finance",
      description: "Runs invoicing, payables, journals and period close.",
      permissions: [
        ...all("finance"),
        ...all("expenses"),
        ...all("reports"),
        ...only("commercial", ["view", "view_sensitive"]),
        ...only("projects", ["view", "view_sensitive"]),
        ...only("procurement", ["view", "approve", "reject", "configure", "view_sensitive"]),
        ...only("crew", ["view", "view_sensitive"]),
        ...only("logistics", ["view"]),
        ...only("documents", ["view", "create"]),
        ...only("organisation", ["view"]),
        ...only("audit", ["view"]),
      ],
    },
    {
      key: "sales",
      name: "Sales",
      description: "Manages clients, opportunities and quotations.",
      permissions: [
        ...all("crm", ["configure"]),
        ...all("expenses"),
        ...all("portal"),
        ...only("commercial", ["view", "create", "edit", "submit", "issue", "export"]),
        ...only("projects", ["view"]),
        ...only("documents", ["view", "create", "edit"]),
        ...only("reports", ["view"]),
        ...only("organisation", ["view"]),
      ],
    },
    {
      key: "project_manager",
      name: "Project manager",
      description: "Plans and runs projects, crew, equipment and logistics.",
      permissions: [
        ...only("crm", ["view"]),
        ...only("commercial", ["view"]),
        ...only("projects", ["view", "create", "edit", "submit", "export"]),
        ...all("production"),
        ...all("expenses"),
        ...only("crew", ["view", "create", "edit", "submit"]),
        ...only("equipment", ["view", "create", "edit", "submit"]),
        ...only("procurement", ["view", "create", "edit", "submit"]),
        ...only("logistics", ["view", "create", "edit", "submit"]),
        ...only("documents", ["view", "create", "edit"]),
        ...only("reports", ["view"]),
        ...only("organisation", ["view"]),
      ],
    },
    {
      key: "crew_coordinator",
      name: "Crew coordinator",
      description: "Keeps crew records, rates and availability, and books crew onto projects.",
      permissions: [
        ...all("crew"),
        ...all("expenses"),
        ...all("portal"),
        ...only("projects", ["view"]),
        ...only("production", ["view"]),
        ...only("logistics", ["view"]),
        ...only("documents", ["view", "create"]),
        ...only("reports", ["view"]),
        ...only("organisation", ["view"]),
      ],
    },
    {
      key: "warehouse",
      name: "Warehouse",
      description:
        "Keeps equipment, stock and maintenance, and returns equipment to service after checks.",
      permissions: [
        ...all("equipment"),
        ...all("expenses"),
        ...only("projects", ["view"]),
        ...only("production", ["view", "create"]),
        ...only("logistics", ["view"]),
        ...only("procurement", ["view"]),
        ...only("documents", ["view", "create"]),
        ...only("reports", ["view"]),
        ...only("organisation", ["view"]),
      ],
    },
    {
      key: "procurement",
      name: "Procurement",
      description:
        "Keeps vendors, raises and amends purchase orders, and records what arrives. Finance approves orders above the threshold.",
      permissions: [
        ...all("procurement", ["approve", "reject", "configure", "view_sensitive"]),
        ...all("expenses"),
        ...all("portal"),
        ...only("projects", ["view"]),
        ...only("equipment", ["view"]),
        ...only("logistics", ["view"]),
        ...only("documents", ["view", "create"]),
        ...only("reports", ["view"]),
        ...only("organisation", ["view"]),
      ],
    },
    {
      key: "show_crew",
      name: "Show crew",
      description:
        "Works at the venue: sees the show day, posts status updates and notes, ticks checklists and reports incidents.",
      permissions: [
        ...only("production", ["view", "create"]),
        ...all("expenses"),
        ...only("projects", ["view"]),
        ...only("documents", ["view"]),
      ],
    },
    {
      key: "viewer",
      name: "Viewer",
      description: "Read-only access to non-sensitive records.",
      permissions: viewEverything.filter((p) => !p.startsWith("audit.") && !p.startsWith("users.")),
    },
  ] satisfies RoleDefinition[]
).map((role) => ({ ...role, permissions: unique(role.permissions) }));
