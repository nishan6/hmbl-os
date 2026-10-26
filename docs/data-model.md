# Data model

The main records and how they connect. The full definition is `prisma/schema.prisma` (140 models); each module's page has the detail. This page is the map.

## Conventions

- Ids are UUIDs. Money is an integer in minor units (`…Minor`, a `BigInt`) with an ISO 4217 currency code beside it; foreign-currency documents also keep the exchange rate and the base-currency amount (`base…Minor`). Rates and percentages are decimals, never floats.
- Records that belong to a legal entity carry `legalEntityId`, and every query and permission check is scoped by it. Clients, vendors, crew and equipment are shared across the group.
- Statuses are enums; moves between them are rules in code (`src/lib/*` and `src/server/*`), and the most important ones are also enforced by database triggers.
- Business documents get numbers from `NumberingScheme` and `NumberCounter`, per entity and document type, without gaps.
- Every change a person makes writes an `AuditEvent` in the same transaction. Audit events, posted journals, issued invoices, stored documents and other evidence are append-only in the database.
- Demo records set `isDemo` and are created only by `prisma/seed.ts`.

## The main chain

```
Client ─ Opportunity ─ Quote ─ QuoteVersion ──accepted──▶ Project
                                   │                        ├─ ProjectBudgetLine ─ ProjectCostEntry (committed, actual)
                                   │                        ├─ ProjectMilestone ──▶ SalesInvoice ─ ReceiptAllocation ─ Receipt
                                   │                        ├─ ProjectChangeOrder (budget versions)
                                   │                        ├─ ProjectResourceRequirement ─ CrewAssignment, EquipmentBooking
                                   │                        ├─ PurchaseOrder ─ GoodsReceipt; VendorBill ─ VendorPaymentAllocation ─ VendorPayment
                                   │                        ├─ TravelRequest, Shipment
                                   │                        ├─ RunOfShowItem, CallSheet, ShowChecklist, ShowIncident
                                   │                        └─ ProjectCloseoutItem
                                   └─ QuoteApprovalStep (approval history)
```

- An accepted `QuoteVersion` becomes exactly one `Project` (`Project.sourceQuoteVersionId` is unique). The project keeps the accepted figures as its baseline.
- **Costs are counted once.** `ProjectCostEntry` rows are committed (an approved purchase order line, a confirmed crew booking) or actual (a bill line, an approved expense, crew work). An actual draws down its commitment (`commitmentId`), so the forecast never adds both.
- `SalesInvoice` points at its client, and optionally its project and billing milestone. Proforma and commercial invoices lead to a tax invoice through `sourceInvoiceId`.

## Ledger

Every financial document posts a `Journal` with balanced `JournalLine`s against `LedgerAccount`s, in the same transaction, and keeps its `journalId`. A journal records where it came from (`source`, `sourceId`) and, when it reverses another, `reversalOfId`. Corrections are new documents (credit notes, voids, reversals); posted journals never change.

| Document                       | Posts                                      | Settled by                                        |
| ------------------------------ | ------------------------------------------ | ------------------------------------------------- |
| `SalesInvoice`, `CreditNote`   | Receivables, revenue, GST                  | `Receipt` through `ReceiptAllocation`             |
| `VendorBill`                   | Expense or asset, GST input, payables, TDS | `VendorPayment` through `VendorPaymentAllocation` |
| `ExpenseClaim`, `StaffAdvance` | Expenses, staff balances                   | `ExpenseSettlement`, `AdvanceReturn`              |
| `Receipt`, `VendorPayment`     | Bank against receivables or payables       | `BankMatch` to a `BankStatementLine`              |
| `OpeningBalance`               | The books brought over at cut-over         | Its `OpeningItem`s are settled like the originals |

`AccountingPeriod` is one month; posting into a closed period is refused by the database. Receivables and payables ageing are worked out from the documents and must agree with their control accounts, which the readiness checks prove.

## People and access

- `User` is either `STAFF` (signs in to HMBL OS, holds `UserRole`s, each for all entities or one) or `EXTERNAL` (a portal user, never holds a role). The kind can't change.
- `Role` holds `RolePermission`s from the catalogue in `src/server/permissions/catalog.ts`.
- `PortalAccount` ties an external user to one client (and contact), vendor or freelancer, with its own portal permissions. `PortalInvitation` and `AccountLink` are the one-use links that create accounts or reset passwords; only a hash of each secret is stored.
- `CrewMember` is a person who works on shows: staff (linked to their user) or a freelancer (linked to a vendor for billing), with `CrewRate`s, `CrewCertification`s and `CrewUnavailability`.

## Operations

- **Equipment**: `EquipmentItem` is a type of thing; `EquipmentAsset` a serialised unit and `EquipmentStock` a counted quantity at a `Location`. `EquipmentBooking` reserves items for a project; `EquipmentAllocation` and `EquipmentBookingMovement` record what went out and came back. `EquipmentMaintenance` takes an asset out of service.
- **Procurement**: `PurchaseOrder` with lines and `PurchaseOrderRevision`s (every approved version is kept), `GoodsReceipt`s, and the vendor's answer in the portal.
- **Travel and logistics**: `TravelRequest` with travellers and `TravelBooking`s (changes kept), `Shipment` with equipment and append-only `ShipmentEvent`s.
- **Show day**: run of show, call sheets, notes, status updates, checklists and incidents per project. `OfflineOperation` records each change sent from the field app, once, by its id.

## Documents, notifications and evidence

- `RecordDocument` belongs to one record (`recordType`, `recordId`), carries its entity and project, and chains versions through `previousVersionId`. The file is on disk under `STORAGE_DIR`, named by `storageKey`.
- `Notification` and `NotificationDelivery` are what people are told and how it was delivered; `NotificationPreference` what they asked for.
- `ImportBatch` and `ImportRow` are spreadsheet imports, previewed before anything is written.
- `ReadinessRun`, `RestoreCheck`, `AppError` and `JobRun` are the production-readiness evidence ([readiness.md](readiness.md), [backups.md](backups.md), [monitoring.md](monitoring.md)).
