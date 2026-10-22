/**
 * The permission catalog. Every permission the server checks is listed here as
 * `<module>.<action>`. Roles store these keys; anything not in the catalog is
 * rejected when a role is saved.
 */

export const ACTIONS = {
  view: "View records",
  create: "Create records",
  edit: "Edit records",
  submit: "Submit for approval",
  approve: "Approve",
  reject: "Reject",
  issue: "Issue to a client or vendor",
  post: "Post to the ledger",
  void: "Void",
  archive: "Archive",
  export: "Export",
  configure: "Manage configuration",
  view_sensitive: "View sensitive financial data",
} as const;

export type Action = keyof typeof ACTIONS;

const standard = ["view", "create", "edit", "archive", "export"] as const satisfies Action[];
const approvable = [...standard, "submit", "approve", "reject"] as const satisfies Action[];

export const MODULES = {
  crm: { label: "CRM", actions: [...standard, "configure"] },
  commercial: {
    label: "Commercial",
    actions: [...approvable, "issue", "configure", "view_sensitive"],
  },
  projects: { label: "Projects", actions: [...approvable, "configure", "view_sensitive"] },
  production: { label: "Production", actions: [...standard] },
  crew: { label: "Crew", actions: [...approvable, "configure", "view_sensitive"] },
  equipment: { label: "Equipment", actions: [...approvable, "configure"] },
  procurement: {
    label: "Procurement",
    actions: [...approvable, "issue", "configure", "view_sensitive"],
  },
  logistics: {
    label: "Travel & Logistics",
    actions: [...approvable, "configure", "view_sensitive"],
  },
  finance: {
    label: "Finance",
    actions: [...approvable, "issue", "post", "void", "configure", "view_sensitive"],
  },
  documents: { label: "Documents", actions: [...standard, "view_sensitive"] },
  reports: { label: "Reports", actions: ["view", "export", "view_sensitive"] },
  organisation: {
    label: "Organisation",
    actions: ["view", "create", "edit", "archive", "configure"],
  },
  users: { label: "Users and roles", actions: ["view", "create", "edit", "archive", "configure"] },
  audit: { label: "Audit log", actions: ["view", "export"] },
} as const satisfies Record<string, { label: string; actions: readonly Action[] }>;

export type Module = keyof typeof MODULES;

export type Permission = {
  [M in Module]: `${M}.${(typeof MODULES)[M]["actions"][number]}`;
}[Module];

export const ALL_PERMISSIONS: readonly Permission[] = Object.entries(MODULES).flatMap(
  ([module, { actions }]) => actions.map((action) => `${module}.${action}` as Permission),
);

const permissionSet = new Set<string>(ALL_PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return permissionSet.has(value);
}
