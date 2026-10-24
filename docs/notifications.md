# Notifications and approvals

Telling people what needs their attention (spec §20). Notifications are information only: they never approve or change anything. Approvals happen on the record itself, and **Approvals** lists everything waiting for the person signed in. The services are in `src/server/notifications/`.

## Where they come from

**Event notifications** (`rules.ts`) are raised by `recordAudit`, inside the same transaction as the change, so a change that rolls back notifies nobody. `AUDIT_RULES` maps an audit action to who is told:

| Change                                 | Who is told                                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| Quotation submitted                    | People with `commercial.approve` for its legal entity                                    |
| Purchase order submitted               | People with `procurement.approve` for its legal entity                                   |
| Vendor bill or expense claim submitted | People with `finance.approve`, and the managers of the projects on its lines             |
| Trip submitted                         | The project manager and people with `logistics.approve`                                  |
| Any of these approved or sent back     | Whoever submitted it (and the quotation's owner); not when it was approved automatically |
| Travel booking changed or cancelled    | Whoever raised the trip and the project manager                                          |
| Crew member proposed for a project     | That crew member, if they have an account                                                |
| Client payment recorded                | The managers of the projects it pays for                                                 |

Whoever made the change is never told about it.

**Date reminders** (`sweep.ts`) run once a day with `pnpm notifications:run`, which also sends queued email. They cover issued quotations about to expire, overdue invoices (when they fall overdue, then at 30 and 60 days), equipment not returned after its booking ended, payment milestones coming up and not yet invoiced, projects whose committed and actual cost passes 90% or 100% of the revised budget, and finished projects whose closeout is still open (weekly). The thresholds are constants at the top of the file; see [decisions.md](decisions.md).

## Never twice

Every notification carries a dedupe key, unique per person: the audit event's id for event notifications, and the record plus the stage or date for reminders. Running the sweep again the same day, or every hour, notifies nobody twice. A duplicate is skipped without an error, so it can never abort the change that caused it.

## Delivery

Each person chooses, per kind, whether to see it in the app, by email, both or neither (**Notifications → Settings**). In-app delivery happens when the notification is created. Email is queued (`notification_deliveries`) and sent by `deliverPending` with up to five attempts, waiting 5, 10, 20 and 40 minutes between them; each delivery records its attempts and last error. Version 1 has no email service (`emailTransport()` returns nothing), so a queued email is marked **Not configured** and never shown as sent. A database check makes "sent" impossible without a delivery time.

Creating a notification and its deliveries is part of the audited change that caused it. The delivery worker's own bookkeeping (attempts, status) is not audited separately. Reading notifications and saving settings are audited.

## Screens

- The bell in the header shows how many are unread and opens **Notifications**, where opening one marks it read and goes to the record.
- **Approvals** lists what is waiting for you, built from the records (`approvals.ts`), so it never depends on whether a notification was sent or read. Each item links to the record, where the decision is made and checked.
