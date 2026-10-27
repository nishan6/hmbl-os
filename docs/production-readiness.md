# Production-readiness checklist

The acceptance gates of the specification (§30 Stage 9 and §32), each with its current status and the evidence behind it. This page says what has been proven, where the proof is, and what has not been done yet. **HMBL OS is not yet in production use**, and this checklist does not claim it is ready: three things only Nishan can do are still open (see "Before go-live").

Status:

- **Proven**: an automated test or a recorded check shows it, and CI runs it on every pull request.
- **Proven, by hand**: checked once on a development copy, with the result recorded; not repeated automatically.
- **Open**: not done, or depends on a decision or on the live installation.

Evidence as of 2026-10-26, on `main` plus the Stage 9 pull requests: 90 unit and integration test files (771 tests), 34 browser test files (99 tests), the performance budget, and 14 readiness checks. The readiness and restore checks below were run on the development database (`hmbl_dev`), never on live data, because there is none yet.

## Before go-live

These are not engineering tasks and can't be done in code:

1. **Finance go-live decisions.** 17 rows in [decisions.md](decisions.md) are marked "Finance go-live": the real legal entity's registered name and tax IDs, fiscal year, chart of accounts, SAC code, invoice numbering, TDS on bills, expense limits, year-end profit and the tax summary. Each has a working default; the accountant should confirm or change them before the first real invoice. Three more are marked "Production": sign-in method, roles and permissions, and numbering schemes.
2. **The live installation.** Create `hmbl_live`, set `.env` as in [deployment.md](deployment.md), create the first owner ([running-locally.md](running-locally.md)), turn on two-factor, and run `pnpm readiness` until nothing fails. A run against `hmbl_dev` correctly warns about the development settings; the live run must show no warnings about demo data, the secret or `APP_ENV`.
3. **Backups on the live computer.** Schedule `pnpm db:backup` daily and copy `backups/` somewhere other than that computer, then run `pnpm db:restore-check` once and monthly after ([backups.md](backups.md)).
4. **Opening balances.** Import them and reconcile to the old books' trial balance at cut-over ([migration.md](migration.md)). Until this is done, financial reports cover only what is entered in HMBL OS.

## Stage 9 verification areas

| Area                     | Status                 | Evidence                                                                                                                                                                                                                                                                  |
| ------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Security                 | Proven                 | [security.md](security.md): security headers, rate-limited sign-in, two-factor for owner, administrator and finance (`two-factor.test.ts`, `two-factor.spec.ts`), one-use account links with only a hash stored (`staff-accounts.test.ts`)                                |
| Access controls          | Proven                 | `server-boundaries.test.ts` fails if any page or server action lacks a guard; `access-sweep.spec.ts` opens every route as every role and as signed-out; permission and entity scope tests in each module's integration file                                               |
| Financial invariants     | Proven                 | `ledger.test.ts`, `invoices.test.ts`, `receipts.test.ts`, `payables.test.ts`, `expenses.test.ts`, `banking.test.ts`; readiness checks "Posted journals balance", "Documents and the ledger agree", "No duplicate postings", "Control accounts agree with open items"      |
| Audit history            | Proven                 | `audit.test.ts`; every service write is tested for its audit event; the database refuses changes to the audit log; readiness checks "Database protections in place" (61 protections) and "Financial records are audited"                                                  |
| Database migrations      | Proven                 | CI applies all migrations to an empty database and fails on drift between the schema and the migrations; readiness check "Migrations applied" also catches an edited migration                                                                                            |
| Backup and restoration   | Proven, by hand        | `recovery-monitoring.test.ts` restores a real backup in CI. On 2026-10-26 `pnpm db:restore-check` restored `hmbl_dev-20261026-1230.dump` into a scratch database in 2.0 s and its books balanced; a deliberately cut-short backup was reported as failed. Not yet on live |
| Performance              | Proven                 | [performance.md](performance.md): 14 busiest reads at about three years of volume, each under 1.5 s median in CI; at four times that volume the slowest is 346 ms after the receivables and payables fix                                                                  |
| Monitoring               | Proven                 | [monitoring.md](monitoring.md): `/api/health`, structured logs, server errors recorded and shown under Readiness, scheduled job runs recorded; readiness checks "No server errors in the last day" and "Scheduled jobs run"                                               |
| Error handling           | Proven                 | Form errors return a message and save nothing (each module's tests); unexpected errors show "Something went wrong" and are recorded (`recovery-monitoring.test.ts`); not-found and access-denied look the same to the user                                                |
| Demo-data isolation      | Proven                 | Demo records only from `prisma/seed.ts`, which refuses `APP_ENV=production`; readiness check "No demo data in the live database" fails on any demo record, demo user or development database name                                                                         |
| Portal isolation         | Proven                 | `portal-access.test.ts`, `client-portal.test.ts`, `vendor-portal.test.ts` and their browser tests: a client sees only its own shared records, a vendor or freelancer only their own, and portal users are refused every staff page                                        |
| Offline behaviour        | Proven                 | [offline.md](offline.md); `offline-sync.test.ts` (each change applied once by its id, conflicts reported, access re-checked on sync), `offline-queue.test.ts`, `offline-pack.test.ts`, `field.spec.ts` with the browser taken offline                                     |
| Financial reports        | Proven                 | `reports.test.ts`: profit and loss, balance sheet and cash flow agree with each other and the trial balance; GST summary, project profitability, CSV downloads and the day book; `reports.spec.ts`. Not yet checked by the accountant against real books                  |
| Migration reconciliation | Proven                 | `imports.test.ts` (preview, validation, duplicates), `opening-balances.test.ts` (the opening trial balance must balance and open items must agree with control accounts). The real cut-over is open (above)                                                               |
| User documentation       | Done                   | [user-guide.md](user-guide.md) and a page per module; not yet read by HMBL staff                                                                                                                                                                                          |
| Deployment and rollback  | Written, partly proven | [deployment.md](deployment.md). The update steps are what CI runs; rollback by restoring the pre-update backup relies on the restore that is proven above. A full update and rollback on the live computer has not been rehearsed                                         |

## Acceptance gates (§32)

### A. Product integrity

| Criterion                                        | Status | Evidence                                                                                                                                                                                                             |
| ------------------------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Modules use consistent records and relationships | Proven | One schema ([data-model.md](data-model.md)); legal entity, client, vendor and project are shared by every module                                                                                                     |
| The principal lifecycle works end to end         | Proven | Enquiry → quote → approval → acceptance → project → purchase → invoice → receipt → closeout: `conversion.spec.ts`, `quote-workflow.spec.ts`, `procurement.spec.ts`, `finance.spec.ts`, `operations-closeout.test.ts` |
| No unnecessary re-entry                          | Proven | Accepting a quote creates the project with its budget and billing milestones (`quote-acceptance.test.ts`); bills start from purchase orders; invoices from milestones                                                |
| Status transitions are controlled                | Proven | Lifecycle rules in code with unit tests (`project-lifecycle`, `pipeline-transitions`, `procurement`, `travel`), and database triggers for posted documents                                                           |
| Business rules are consistent                    | Proven | Money, tax and pricing in one place each (`src/lib/money.ts`, `gst.ts`, `pricing.ts`) with unit tests                                                                                                                |
| Unresolved policies remain configurable          | Proven | [decisions.md](decisions.md): every undecided policy has a labelled default and says how to change it                                                                                                                |

### B. Commercial integrity

| Criterion                                   | Status | Evidence                                                                                                                                                                            |
| ------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Margin and markup are calculated correctly  | Proven | `pricing.test.ts`; [commercial.md](commercial.md)                                                                                                                                   |
| Pricing methods are clearly distinguished   | Proven | Method per line, shown on the quote; `quotes.test.ts`                                                                                                                               |
| Contingency and approval rules are enforced | Proven | `quote-workflow.test.ts`: quotes above the approval threshold can't be issued until approved, and a Director approving their own quote is flagged; `quotes.test.ts` for contingency |
| Quote revisions are preserved               | Proven | Approved and issued versions can't change; a revision is a new version (`quotes.test.ts`)                                                                                           |
| Approved quotations convert correctly       | Proven | One project per accepted version, enforced by a unique key (`quote-acceptance.test.ts`, `conversion.spec.ts`)                                                                       |
| Accepted terms remain traceable             | Proven | The project keeps the accepted version, acceptance details and client PO                                                                                                            |

### C. Financial integrity

| Criterion                                           | Status | Evidence                                                                                                           |
| --------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------ |
| Posted journals balance                             | Proven | `ledger.test.ts`; the database refuses an unbalanced posting; readiness check                                      |
| Controlled lifecycles                               | Proven | Draft → issued/approved → settled or voided, per document; posted documents can't be edited (triggers)             |
| Duplicate posting is prevented                      | Proven | One journal per idempotency key per entity (unique index); readiness check                                         |
| Corrections preserve the audit trail                | Proven | Credit notes, voids and reversals are new documents; posted journals never change                                  |
| Invoice, receipt and payment states remain distinct | Proven | Separate records and statuses; settlement only through allocations (`receipts.test.ts`, `payables.test.ts`)        |
| Receivables and payables reconcile                  | Proven | Ageing worked out from the documents and checked against the control accounts (readiness check, `reports.test.ts`) |
| Multi-currency keeps transaction history            | Proven | Rate and base amount stored on each document (`fx.test.ts`, `invoices.test.ts`)                                    |
| Project reports avoid double-counting               | Proven | Actuals draw down their commitment (`budget-integrity.test.ts`)                                                    |
| Period close is controlled                          | Proven | Posting into a closed month is refused by the database (`ledger.test.ts`); [period-close.md](period-close.md)      |

### D. Operational integrity

| Criterion                                                  | Status         | Evidence                                                                                     |
| ---------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------- |
| Crew assignments connect to projects                       | Proven         | `crew-assignments.test.ts`, `resources.test.ts`                                              |
| Equipment availability reflects bookings, returns, repairs | Proven         | `equipment-bookings.test.ts`, `equipment.test.ts`                                            |
| Commitments and actual costs handled consistently          | Proven         | `procurement.test.ts`, `payables.test.ts`, `budget-integrity.test.ts`                        |
| Expenses and advances not double-counted                   | Proven         | `expenses.test.ts`, `settlement.test.ts`                                                     |
| Travel and logistics connected to projects                 | Proven         | `travel.test.ts`, `shipments.test.ts`                                                        |
| Show-day information is practical and reliable             | Proven, partly | `production.test.ts`, `show-pack.test.ts`, `production.spec.ts`. Not yet used at a real show |

### E. Security

| Criterion                                        | Status | Evidence                                                                                                           |
| ------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------ |
| Server-side permissions enforced                 | Proven | `server-boundaries.test.ts`, `access-sweep.spec.ts`, `permissions.test.ts`                                         |
| Legal-entity and project access scoped           | Proven | Each module's integration tests refuse a user scoped to another entity                                             |
| Clients can't see internal records               | Proven | `client-portal.test.ts`, `client-portal.spec.ts`                                                                   |
| Vendors can't see other vendors' records         | Proven | `vendor-portal.test.ts`, `vendor-portal.spec.ts`                                                                   |
| Sensitive financial and personal data restricted | Proven | Bank details, crew rates and restricted documents need their own permissions (`crew.test.ts`, `documents.test.ts`) |
| Documents are securely accessed                  | Proven | Files are served only after checking the record's access (`record-documents.test.ts`, `documents.spec.ts`)         |
| Important actions are audited                    | Proven | See Audit history above                                                                                            |

### F. Offline capability

| Criterion                          | Status | Evidence                                                                                         |
| ---------------------------------- | ------ | ------------------------------------------------------------------------------------------------ |
| Offline scope documented           | Proven | [offline.md](offline.md)                                                                         |
| Offline state is visible           | Proven | `field.spec.ts`                                                                                  |
| Changes synchronise safely         | Proven | `offline-sync.test.ts`                                                                           |
| Duplicate execution prevented      | Proven | Each operation applied once by its id (`offline-sync.test.ts`)                                   |
| Conflicts and failures recoverable | Proven | Conflicts are reported back and kept for retry (`offline-sync.test.ts`, `offline-queue.test.ts`) |
| Limitations communicated           | Proven | Limits section of [offline.md](offline.md), and in the field app                                 |

### G. Design quality

| Criterion                                   | Status         | Evidence                                                                                               |
| ------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------ |
| One cohesive design system                  | Proven         | [design-system.md](design-system.md); `design-tokens.test.ts` checks the tokens and their contrast     |
| Light and dark themes work                  | Proven         | `accessibility.spec.ts` checks every listed page in both                                               |
| Consistent forms, tables, dialogs, statuses | Proven         | Shared `src/components/ui` primitives; status is colour, icon and label                                |
| Responsive layouts                          | Proven, partly | `shell.spec.ts` at phone width; not every page has been checked on a phone                             |
| Accessibility checks performed              | Proven         | axe at WCAG 2.2 AA on the pages in `accessibility.spec.ts`, light and dark                             |
| Loading, empty, error and success states    | Proven         | Lists have empty states; the signed-in app has shared loading and error pages; forms show their result |
| Financial information clear and precise     | Proven         | Integer minor units, `tabular` figures, `format.test.ts`                                               |
| Premium without losing efficiency           | Open           | A judgement for HMBL's own staff to make once they use it                                              |

### H. Data migration and recovery

| Criterion                              | Status                              | Evidence                                                                                    |
| -------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------- |
| Imports support preview and validation | Proven                              | `imports.test.ts`, `imports.spec.ts`                                                        |
| Duplicate handling is controlled       | Proven                              | `imports.test.ts`, `clients.test.ts`                                                        |
| Financial migration is reconciled      | Proven in tests; open for real data | `opening-balances.test.ts`, `opening-balances.spec.ts`. The real cut-over is a go-live step |
| Backup and restore have been tested    | Proven, by hand                     | See Backup and restoration above                                                            |
| Production and demo data stay separate | Proven                              | See Demo-data isolation above                                                               |

### I. Version 1 scope

| Criterion                                       | Status | Evidence                                                                                                                    |
| ----------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| No AI features or infrastructure                | Proven | No AI packages in `package.json`; none in the code                                                                          |
| No mock integration shown as live               | Proven | [integrations.md](integrations.md): status worked out from configuration; email shows "Not set up" and is never marked sent |
| No untested critical workflow labelled complete | Proven | Every module page lists its tests; the open items here are labelled open                                                    |
| Known limitations documented                    | Proven | Below, and each module's page                                                                                               |
| Completion claims supported by evidence         | Proven | This page                                                                                                                   |

## Known limitations

- **One computer.** HMBL OS runs on one computer ([decisions.md](decisions.md), Hosting). Using it from elsewhere needs the server set-up in [deployment.md](deployment.md), which has not been tested.
- **No email.** Notifications appear in the app; email is "Not set up" until a mail provider is chosen. Invitation and password links are copied and sent by the administrator.
- **No outside integrations.** Google, Tally, live bank feeds, payment providers and WhatsApp are not connected ([integrations.md](integrations.md)). Bank statements come in by CSV.
- **Offline is the field app only**, for show-day checklists, notes, status updates and incidents; data on the device is protected only by the device's own lock ([offline.md](offline.md)).
- **Defaults are not policy.** 124 decisions in [decisions.md](decisions.md) are working defaults, not approved company policy.
- **Closeout is partly by hand.** Invoices issued, payments collected and expenses reconciled are ticked by a person, not checked against Finance's records ([closeout.md](closeout.md)).
- **Content Security Policy is partial**: scripts are not yet restricted by nonce ([security.md](security.md)).
- **Not yet used by real people** on real work. The first weeks of use will find things tests can't.

## Repeating the checks

```bash
pnpm check          # lint, types, formatting, unit and integration tests
pnpm test:perf      # the performance budget
pnpm build && pnpm test:e2e
pnpm readiness      # against the database in DATABASE_URL
pnpm db:restore-check
```

Every readiness and restore run is recorded and listed under **Administration → Readiness**.
