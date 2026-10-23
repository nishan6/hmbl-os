import {
  Boxes,
  Briefcase,
  Building2,
  ClipboardList,
  Database,
  FileText,
  Hash,
  Home,
  Landmark,
  LineChart,
  Plane,
  ScrollText,
  ShoppingCart,
  Theater,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/server/permissions/catalog";

export type NavItem = {
  label: string;
  icon: LucideIcon;
  /** Shown only to users with this permission (for any entity). */
  permission?: Permission;
  /** Built areas link somewhere; planned ones are listed but not clickable. */
  href?: string;
};

export type NavGroup = { label?: string; items: NavItem[] };

/**
 * The information architecture from the spec (§5). Modules that don't exist
 * yet are shown as planned rather than linking to empty pages.
 */
export const NAV: NavGroup[] = [
  { items: [{ label: "Home", icon: Home, href: "/" }] },
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
      { label: "Production", icon: Theater, permission: "production.view" },
      { label: "Crew", icon: Users, permission: "crew.view" },
      { label: "Equipment", icon: Boxes, permission: "equipment.view" },
      { label: "Procurement", icon: ShoppingCart, permission: "procurement.view" },
      { label: "Travel & Logistics", icon: Plane, permission: "logistics.view" },
    ],
  },
  {
    label: "Finance",
    items: [
      { label: "Finance", icon: Landmark, permission: "finance.view" },
      { label: "Documents", icon: FileText, permission: "documents.view" },
      { label: "Reports", icon: LineChart, permission: "reports.view" },
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
      { label: "Users", icon: UserCog, permission: "users.view", href: "/admin/users" },
      { label: "Audit log", icon: ScrollText, permission: "audit.view", href: "/admin/audit" },
    ],
  },
];
