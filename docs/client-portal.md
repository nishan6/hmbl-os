# Client portal

What a client's portal users see and do (spec §18). Access itself (accounts, invitations, permissions) is in [portal.md](portal.md). The services are `src/server/portal/sharing.ts` (staff choosing what to share) and `src/server/portal/client.ts` (everything the client reads and does); the pages are under `src/app/portal/`.

## Nothing is visible until it is shared

A client sees a project, quotation or document only while a live **share** (`portal_shares`) exists for it. Sharing is explicit and recorded:

| Record                                                    | Who may share it                                                              | Shown to the client                                                                                                    |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Project (with a client, not cancelled)                    | `projects.edit` in its entity, from the project page                          | Name, number, dates, venue, a client-facing status and the payment milestones (label, amount, due date)                |
| Quotation (issued at least once)                          | `commercial.issue` in its entity, from the quotation page                     | The latest version HMBL sent: lines at sell price, totals, payment schedule, scope, deliverables, exclusions and terms |
| Document on the client, one of its projects or quotations | `documents.edit` and the right to change that record, from the documents list | The file, always as its newest standard version                                                                        |

Invoices need no share: a client with `invoices.view` sees every **issued** invoice addressed to it, with the balance due on tax invoices and the bank accounts marked for invoices. Drafts and discarded invoices never appear.

The client never sees costs, budgets, margins, crew pay, supplier prices, internal notes, approval history, restricted documents or anything belonging to another client. Every portal query is filtered by the account's client and selects named client-facing fields only; tests check the exact fields returned.

The database backs this up: a share must point at a record of the share's own client (`portal_share_guard`), documents must be standard access, shares are never deleted, and a share can only be stopped, once. Sharing again creates a new share, so the history shows who shared what and when.

A share of a document covers all its versions. When a new version is uploaded the client gets it automatically, unless the new version is restricted, in which case they keep the last standard one. Archiving a document removes it from the portal.

Projects created by a portal acceptance are not shared automatically. Share the project when the client should follow it.

## Answering a quotation

A client with `quotes.respond` can accept or decline the latest issued version while it is valid:

- **Accept**: they type their name, give their purchase order number if the quotation needs one, and tick a statement that names the quotation, the version and the HMBL entity and says it is not an electronic signature. HMBL OS then records the acceptance exactly as when staff record it (method "Client portal"), creating the project in the same transaction, and the quotation's owner is notified.
- **Decline**: they type their name and a reason, which the owner sees in the notification.

Each answer stores, unchangeably (`quote_portal_responses`): the signed-in user and account, the typed name, the statement they ticked, the time, the IP address and browser, the version, its total and currency, and a SHA-256 fingerprint of exactly what the client was shown. The quotation page shows all of this to staff under **Answered in the client portal**.

An answer is refused if the quotation changed since the client opened it (the fingerprint no longer matches), if it has expired, if HMBL has started a new version, or if it was already answered. This is a record of the client's acceptance with supporting evidence; it is not an electronic signature under the IT Act 2000, and the pages never call it one.

## Sending information

On a shared project, a client with `requests.submit` can send HMBL a subject and details (venue access, contacts, schedules). It appears on the project page under **From the client portal**, its project manager is notified, and it can't be edited or deleted. Everyone at the client with this permission sees what their organisation sent for that project.

## Notifications

`portal.client_activity`: the quotation's owner when the client accepts or declines in the portal, and the project manager when the client sends information. Answers recorded by staff don't notify.

## Audit

`portal_share.created` and `portal_share.revoked`; `quote.accepted` and `quote.declined` by the portal user, with `via: "portal"`, the response id and the fingerprint; `portal_submission.created`.

## Demo

`pnpm db:seed` shares the demo client's projects, issued quotations and seeded documents with `client@demo.hmbl.test`.
