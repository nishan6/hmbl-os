import {
  Plug,
  Boxes,
  Briefcase,
  Building2,
  ClipboardList,
  Database,
  DoorOpen,
  FileText,
  HardHat,
  Hash,
  Home,
  Inbox,
  Landmark,
  LineChart,
  Plane,
  ScrollText,
  ShoppingCart,
  Theater,
  UserCog,
  Users,
  Wallet,
  Upload,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/server/permissions/catalog";

export type NavItem = {
  label: string;
  icon: LucideIcon;
  /** Shown only to users with this permission (for any entity). */
  permission?: Permission;
  /** Shown to users with any one of these, for areas several modules share. */
  anyPermission?: Permission[];
  /** Built areas link somewhere; planned ones are listed but not clickable. */
  href?: string;
};

export type NavGroup = { label?: string; items: NavItem[] };

/**
 * The information architecture from the spec (§5). Modules that don't exist
 * yet are shown as planned rather than linking to empty pages.
 */
export const NAV: NavGroup[] = [
  {
    items: [
      { label: "Home", icon: Home, href: "/" },
      { label: "Approvals", icon: Inbox, href: "/approvals" },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "CRM", icon: Users, permission: "crm.view", href: "/crm" },
      {
        label: "Commercial",
        icon: ClipboardList,
        permission: "commercial.view",
        href: "/quotes",
      },
      { label: "Projects", icon: Briefcase, permission: "projects.view", href: "/projects" },
      {
        label: "Production",
        icon: Theater,
        permission: "production.view",
        href: "/production",
      },
      { label: "Crew", icon: HardHat, permission: "crew.view", href: "/crew" },
      { label: "Equipment", icon: Boxes, permission: "equipment.view", href: "/equipment" },
      {
        label: "Procurement",
        icon: ShoppingCart,
        permission: "procurement.view",
        href: "/procurement",
      },
      {
        label: "Travel & Logistics",
        icon: Plane,
        permission: "logistics.view",
        href: "/logistics",
      },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Finance", icon: Landmark, permission: "finance.view", href: "/finance" },
      { label: "Expenses", icon: Wallet, permission: "expenses.view", href: "/expenses" },
      { label: "Documents", icon: FileText, permission: "documents.view", href: "/documents" },
      { label: "Reports", icon: LineChart, permission: "reports.view", href: "/reports" },
    ],
  },
  {
    label: "Administration",
    items: [
      {
        label: "Organisation",
        icon: Building2,
        permission: "organisation.view",
        href: "/admin/organisation",
      },
      {
        label: "Master data",
        icon: Database,
        permission: "organisation.view",
        href: "/admin/master-data",
      },
      {
        label: "Numbering",
        icon: Hash,
        permission: "organisation.view",
        href: "/admin/numbering",
      },
      {
        label: "Imports",
        icon: Upload,
        anyPermission: [
          "crm.create",
          "finance.create",
          "procurement.create",
          "crew.create",
          "equipment.create",
        ],
        href: "/admin/imports",
      },
      {
        label: "Integrations",
        icon: Plug,
        permission: "organisation.view",
        href: "/admin/integrations",
      },
      { label: "Users", icon: UserCog, permission: "users.view", href: "/admin/users" },
      {
        label: "Portal access",
        icon: DoorOpen,
        permission: "portal.view",
        href: "/admin/portal-access",
      },
      { label: "Audit log", icon: ScrollText, permission: "audit.view", href: "/admin/audit" },
    ],
  },
];
