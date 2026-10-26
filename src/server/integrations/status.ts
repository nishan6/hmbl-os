import "server-only";
import { db } from "@/server/db";
import { authorize, type Actor } from "@/server/permissions/authorize";
import { emailTransport } from "@/server/notifications/delivery";

/*
 * What HMBL OS connects to, and whether each connection actually works today
 * (spec §22, docs/integrations.md). Statuses come from facts in the database
 * and the configuration, never from a setting someone typed: nothing is shown
 * as working unless it is.
 */

/**
 * - `working`: built into HMBL OS and in use without any outside account.
 * - `not_set_up`: HMBL OS is ready for it, but no provider is configured, so
 *   nothing is sent.
 * - `not_built`: no connection exists. The fallback says what to do instead.
 */
export type IntegrationState = "working" | "not_set_up" | "not_built";

export type Integration = {
  key: string;
  name: string;
  state: IntegrationState;
  /** What it is for at HMBL. */
  use: string;
  /** Which system holds the true record. */
  sourceOfTruth: string;
  /** Which way data moves. */
  direction: string;
  /** What happens today, in plain words. */
  detail: string;
  /** Live facts behind the status. */
  facts: string[];
  /** Where it lives in HMBL OS, when it does. */
  href?: string;
};

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const day = (d: Date) => d.toISOString().slice(0, 10);

/** Every integration the spec lists, with its honest status (`organisation.view`). */
export async function listIntegrations(actor: Actor): Promise<Integration[]> {
  authorize(actor, "organisation.view");
  const monthAgo = new Date(Date.now() - 30 * 86_400_000);
  const [lastImport, imports, lastStatement, feeds, lastFeed, unsent, emailOn] = await Promise.all([
    db.importBatch.findFirst({
      where: { status: "COMMITTED" },
      orderBy: { committedAt: "desc" },
      select: { committedAt: true },
    }),
    db.importBatch.count({ where: { status: "COMMITTED" } }),
    db.bankStatementLine.findFirst({ orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    db.calendarFeed.count(),
    db.calendarFeed.findFirst({
      where: { lastUsedAt: { not: null } },
      orderBy: { lastUsedAt: "desc" },
      select: { lastUsedAt: true },
    }),
    db.notificationDelivery.count({
      where: { channel: "EMAIL", status: "NOT_CONFIGURED", createdAt: { gte: monthAgo } },
    }),
    db.notificationPreference
      .findMany({ where: { email: true }, distinct: ["userId"], select: { userId: true } })
      .then((rows) => rows.length),
  ]);
  const transport = emailTransport();

  return [
    {
      key: "csv-import",
      name: "CSV and spreadsheet import",
      state: "working",
      use: "Bring clients, vendors, contacts, crew and equipment over from spreadsheets.",
      sourceOfTruth: "HMBL OS, once a batch is committed",
      direction: "Into HMBL OS",
      detail:
        "Upload a CSV saved from Excel or Google Sheets, map the columns, check every row and decide on duplicates before anything is written.",
      facts: [
        `${count(imports, "batch", "batches")} committed`,
        lastImport?.committedAt ? `Last on ${day(lastImport.committedAt)}` : "None yet",
      ],
      href: "/admin/imports",
    },
    {
      key: "opening-balances",
      name: "Opening balances from the old books",
      state: "working",
      use: "Move the books from the old accounting system at a cut-over date.",
      sourceOfTruth: "The old system up to the cut-over, HMBL OS after",
      direction: "Into HMBL OS, once",
      detail:
        "Trial balance, open invoices and open bills come in as CSV and post only when every total agrees with the old system's reports.",
      facts: [],
      href: "/finance/opening-balances",
    },
    {
      key: "accountant-exports",
      name: "Reports and day book for the accountant",
      state: "working",
      use: "Hand the accountant the books in a form their own software or spreadsheet can read.",
      sourceOfTruth: "HMBL OS",
      direction: "Out of HMBL OS, as downloads",
      detail:
        "Each financial report and the day book of every posted journal line download as CSV. Nothing is sent anywhere automatically.",
      facts: [],
      href: "/finance/reports",
    },
    {
      key: "bank-statements",
      name: "Bank statements",
      state: "working",
      use: "Reconcile the bank accounts.",
      sourceOfTruth: "The bank",
      direction: "Into HMBL OS, by file",
      detail:
        "Statements are uploaded as CSV from the bank's website and matched in bank reconciliation. There is no live connection to a bank.",
      facts: [lastStatement ? `Last line added on ${day(lastStatement.createdAt)}` : "None yet"],
      href: "/finance/bank-accounts",
    },
    {
      key: "calendar-feed",
      name: "Calendar feed",
      state: "working",
      use: "See show dates, phases and milestones in Google Calendar, Outlook or Apple Calendar.",
      sourceOfTruth: "HMBL OS",
      direction: "Out of HMBL OS, read-only",
      detail:
        "Each person makes a private link under their account and subscribes to it. Calendars refresh it themselves, usually every few hours. Google Calendar can read it only once HMBL OS is on the internet.",
      facts: [
        `${count(feeds, "link")} on`,
        lastFeed?.lastUsedAt ? `Last read on ${day(lastFeed.lastUsedAt)}` : "Not read yet",
      ],
      href: "/account/calendar",
    },
    {
      key: "email",
      name: "Email notifications",
      state: transport ? "working" : "not_set_up",
      use: "Send notifications to people who chose email.",
      sourceOfTruth: "HMBL OS",
      direction: "Out of HMBL OS",
      detail: transport
        ? "Email is sent through the configured provider, with retries."
        : "No mail provider is set up, so no email is sent. Each email that would have gone is recorded as not sent, never as delivered. Notifications still appear in the app.",
      facts: [
        `${count(emailOn, "person", "people")} chose email`,
        ...(transport ? [] : [`${count(unsent, "email")} not sent in the last 30 days`]),
      ],
    },
    {
      key: "google-calendar",
      name: "Google Calendar sync",
      state: "not_built",
      use: "Two-way sync of bookings with people's Google calendars.",
      sourceOfTruth: "Not decided",
      direction: "Not decided",
      detail:
        "Not connected. Needs a Google Cloud project, OAuth consent and a rule for which side wins a conflict. Use the calendar feed meanwhile.",
      facts: [],
    },
    {
      key: "gmail",
      name: "Gmail",
      state: "not_built",
      use: "Send invoices and notifications from HMBL's own mailboxes, or log client email.",
      sourceOfTruth: "Gmail",
      direction: "Not decided",
      detail: "Not connected. Needs a Google Workspace account and approved scopes.",
      facts: [],
    },
    {
      key: "google-drive",
      name: "Google Drive",
      state: "not_built",
      use: "Keep or link project documents in shared drives.",
      sourceOfTruth: "HMBL OS stores its own files today",
      direction: "Not decided",
      detail:
        "Not connected. Documents are stored by HMBL OS itself and backed up with the database.",
      facts: [],
    },
    {
      key: "google-sheets",
      name: "Google Sheets",
      state: "not_built",
      use: "Live sheets of HMBL OS data.",
      sourceOfTruth: "HMBL OS",
      direction: "Not decided",
      detail:
        "Not connected. Download a CSV from HMBL OS and open it in Sheets, or import a sheet saved as CSV.",
      facts: [],
    },
    {
      key: "tally",
      name: "Tally export",
      state: "not_built",
      use: "Give the accountant vouchers they can import into Tally.",
      sourceOfTruth: "HMBL OS",
      direction: "Out of HMBL OS",
      detail:
        "Not built. Waiting for the accountant to confirm the Tally version and import format (XML or Excel). The day book CSV covers the same entries meanwhile.",
      facts: [],
    },
    {
      key: "bank-feeds",
      name: "Live bank feeds",
      state: "not_built",
      use: "Statements arriving without uploading a file.",
      sourceOfTruth: "The bank",
      direction: "Into HMBL OS",
      detail:
        "Not connected. Needs a bank or account aggregator API agreement. Upload statements as CSV meanwhile.",
      facts: [],
    },
    {
      key: "payments",
      name: "Payment providers",
      state: "not_built",
      use: "Let clients pay invoices online.",
      sourceOfTruth: "The provider",
      direction: "Not decided",
      detail: "Not connected. Receipts are recorded by hand from the bank statement.",
      facts: [],
    },
    {
      key: "messaging",
      name: "WhatsApp or SMS",
      state: "not_built",
      use: "Reach crew and vendors on their phones.",
      sourceOfTruth: "HMBL OS",
      direction: "Out of HMBL OS",
      detail: "Not connected. Needs an approved messaging provider and message templates.",
      facts: [],
    },
  ];
}
