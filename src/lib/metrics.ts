/*
 * Every figure on a management dashboard (spec §21): what it counts and
 * where it comes from. The dashboards show each definition next to its
 * figure, and /reports/definitions lists them all. Change a definition here
 * and in the service that computes it, together.
 */

export type Dashboard = "executive" | "projects" | "production";

export type Metric = {
  label: string;
  dashboard: Dashboard;
  definition: string;
  source: string;
};

export const METRICS = {
  // ─── Executive ─────────────────────────────────────────────────────────────
  pipeline: {
    label: "Sales pipeline",
    dashboard: "executive",
    definition:
      "Open opportunities (in a stage of kind Open), their expected value, and that value weighted by the win probability of the opportunity or, if it has none, its stage. Opportunities without a value count but add nothing. Shown per currency, with no conversion.",
    source: "CRM opportunities and pipeline stages",
  },
  quotesAwaitingApproval: {
    label: "Quotes awaiting approval",
    dashboard: "executive",
    definition:
      "Quotes whose latest version is pending approval, and the total of those versions including tax, per currency.",
    source: "Quote versions",
  },
  activeProjects: {
    label: "Active projects",
    dashboard: "executive",
    definition:
      "Projects that are Approved, Planning, Ready or In progress. On hold, completed and closing projects are not active.",
    source: "Projects",
  },
  contractedRevenue: {
    label: "Contracted revenue",
    dashboard: "executive",
    definition:
      "For every project from Approved up to Financial close (not Closed or Cancelled, including On hold): the contract value before tax plus the revenue of approved change orders, per currency.",
    source: "Projects and approved change orders",
  },
  invoicedRevenue: {
    label: "Invoiced revenue",
    dashboard: "executive",
    definition:
      "Issued tax invoices dated in the financial year to date, before tax, less issued credit notes dated in the same dates, in the base currency at each document's rate. Proforma and commercial invoices don't count. This can differ from revenue in the profit and loss when revenue waits for project completion.",
    source: "Sales invoices and credit notes",
  },
  collections: {
    label: "Collections",
    dashboard: "executive",
    definition:
      "Posted receipts dated in the financial year to date: money received plus tax deducted at source by the client, in the base currency as posted.",
    source: "Receipts",
  },
  receivables: {
    label: "Outstanding receivables",
    dashboard: "executive",
    definition:
      "What clients owe today on issued invoices after receipts and credit notes, and the part past its due date. The same figure as the receivables ageing.",
    source: "Receivables ageing (Finance)",
  },
  payables: {
    label: "Payables",
    dashboard: "executive",
    definition:
      "What HMBL owes vendors today on approved bills after payments, and the part past its due date. The same figure as the payables ageing.",
    source: "Payables ageing (Finance)",
  },
  cashAndBank: {
    label: "Cash and bank",
    dashboard: "executive",
    definition:
      "The balance in the books today of every bank and cash account, from posted journals. Not a live bank balance: bank accounts are as reconciled as their last statement.",
    source: "Ledger (bank and cash accounts)",
  },
  projectGrossProfit: {
    label: "Project gross profit",
    dashboard: "executive",
    definition:
      "Revenue less direct costs on journal lines tagged with a project, posted in the financial year to date, and the margin as a share of that revenue. Overheads are not allocated. The same figures as the project profitability report.",
    source: "Ledger (journal lines tagged with a project)",
  },
  budgetExceptions: {
    label: "Budget exceptions",
    dashboard: "executive",
    definition:
      "Projects from Approved up to Financial close whose forecast cost is above their revised budget (original budget plus approved changes).",
    source: "Project budgets, cost entries and change orders",
  },
  upcomingShows: {
    label: "Upcoming production commitments",
    dashboard: "executive",
    definition:
      "Projects with a show or phase on their schedule in the next 30 days, from today in the entity's time zone.",
    source: "Project schedules",
  },
  resourceConflicts: {
    label: "Resource conflicts",
    dashboard: "executive",
    definition:
      "From today on: confirmed crew bookings that share a day with another confirmed booking or time off of the same person, and live equipment bookings reserved beyond what was free (a shortfall approved by override).",
    source: "Crew assignments, crew time off and equipment bookings",
  },
  businessLines: {
    label: "Business-line performance",
    dashboard: "executive",
    definition:
      "Project gross profit for the financial year to date, grouped by each project's business unit. Projects without a business unit are grouped as Unassigned.",
    source: "Ledger (journal lines tagged with a project) and projects",
  },

  // ─── Project manager ───────────────────────────────────────────────────────
  projectSchedule: {
    label: "Schedule and milestones",
    dashboard: "projects",
    definition:
      "The next schedule item not yet finished, and delivery milestones past their date and not ticked off.",
    source: "Project schedules",
  },
  projectBudget: {
    label: "Budget against actual",
    dashboard: "projects",
    definition:
      "Revised budget (original plus approved changes), actual cost, open commitments and forecast cost, in the project's currency. Shown only to people who may see project costs.",
    source: "Project budgets and cost entries",
  },
  missingApprovals: {
    label: "Missing approvals",
    dashboard: "projects",
    definition:
      "Change orders in draft, purchase orders waiting for approval, and trips submitted and not yet approved, on the project.",
    source: "Change orders, purchase orders and travel requests",
  },
  crewConfirmations: {
    label: "Crew confirmations",
    dashboard: "projects",
    definition:
      "People on the project's crew requirements who have confirmed, against the number needed, and bookings still only proposed.",
    source: "Crew requirements and assignments",
  },
  equipmentAvailability: {
    label: "Equipment availability",
    dashboard: "projects",
    definition:
      "Units reserved against the project's equipment requirements, against the number needed, and live bookings reserved beyond what was free.",
    source: "Equipment requirements and bookings",
  },
  travelReadiness: {
    label: "Travel readiness",
    dashboard: "projects",
    definition:
      "Trips in draft or submitted (not yet approved), and bookings on approved trips still held rather than confirmed.",
    source: "Travel requests and bookings",
  },
  clientInputs: {
    label: "Outstanding client inputs",
    dashboard: "projects",
    definition: "Draft change orders that change revenue and have no client approval recorded yet.",
    source: "Change orders",
  },
  invoiceMilestones: {
    label: "Invoice milestones",
    dashboard: "projects",
    definition:
      "Billing milestones due in the next 30 days or already due, with no issued tax invoice against them.",
    source: "Billing milestones and sales invoices",
  },
  closeoutRequirements: {
    label: "Closeout requirements",
    dashboard: "projects",
    definition:
      "For completed projects and projects in financial close: closeout checklist items not yet done.",
    source: "Project closeout checklist",
  },

  // ─── Production ────────────────────────────────────────────────────────────
  upcomingEvents: {
    label: "Upcoming events",
    dashboard: "production",
    definition:
      "Shows with a show or phase day today or in the next 30 days, soonest first, from today in each entity's time zone.",
    source: "Project schedules",
  },
  showStatus: {
    label: "Current show status",
    dashboard: "production",
    definition: "The latest status update posted on the show, with when it was posted.",
    source: "Show status updates",
  },
  crewReadiness: {
    label: "Crew readiness",
    dashboard: "production",
    definition:
      "Confirmed crew against the crew needed by the show's requirements, and bookings still only proposed.",
    source: "Crew requirements and assignments",
  },
  equipmentReadiness: {
    label: "Equipment readiness",
    dashboard: "production",
    definition:
      "Units reserved against the equipment needed, units dispatched so far, and bookings with a shortfall.",
    source: "Equipment requirements and bookings",
  },
  logisticsReadiness: {
    label: "Logistics readiness",
    dashboard: "production",
    definition:
      "Shipments not yet booked (planned), trips not yet approved, and travel bookings still held.",
    source: "Shipments, travel requests and bookings",
  },
  openIssues: {
    label: "Open operational issues",
    dashboard: "production",
    definition:
      "Incidents reported on the show and not yet resolved, by severity. Who was involved is never shown here.",
    source: "Show incidents",
  },
  keyContacts: {
    label: "Key contacts",
    dashboard: "production",
    definition: "The project manager and producer of each show.",
    source: "Projects",
  },
  recentChanges: {
    label: "Recent changes",
    dashboard: "production",
    definition:
      "The latest status updates and notes across the upcoming shows, newest first, up to 15.",
    source: "Show status updates and production notes",
  },
} as const satisfies Record<string, Metric>;

export type MetricKey = keyof typeof METRICS;

export const DASHBOARDS: Record<Dashboard, { label: string; href: string }> = {
  executive: { label: "Executive", href: "/reports/executive" },
  projects: { label: "Project manager", href: "/reports/projects" },
  production: { label: "Production", href: "/reports/production" },
};

/** Days ahead the dashboards look for shows and milestones. */
export const LOOKAHEAD_DAYS = 30;

/** Amounts in more than one currency, never converted: { INR: 100n, USD: 5n }. */
export type ByCurrency = Record<string, bigint>;

export function addTo(sums: ByCurrency, currency: string, minor: bigint) {
  sums[currency] = (sums[currency] ?? 0n) + minor;
  return sums;
}
