# Ledger and chart of accounts

Each legal entity keeps its own double-entry books in its base currency (spec §11, "Accounting foundations"). The posting engine is `src/server/finance/ledger.ts`. The chart is in `accounts.ts` and `accounts-default.ts`, manual journals are in `journals.ts`, and the trial balance and account ledger are in `ledger-reports.ts`. The arithmetic is in `src/lib/ledger.ts` and the financial-year maths in `src/lib/fiscal.ts`, both with unit tests.

## Chart of accounts

Every account belongs to one entity and has a **type** (asset, liability, equity, income, expense) and a **heading** (cash, bank, receivables, direct costs, overheads…). Headings decide where an account appears in the statements. A database CHECK keeps each heading under its own type.

New entities get the default chart when they are created. An existing entity can add it from Finance → Chart of accounts with "Set up the default chart", and the same button later adds any default accounts that are missing. The default chart is a labelled starting point for an Indian live production company. Indian entities get CGST, SGST and IGST input and output accounts plus TDS receivable and payable. Entities in other countries get input and output VAT instead. HMBL's accountant should review the chart before go-live (see [decisions.md](decisions.md)).

- **Posting roles.** Some accounts carry a `systemKey` (RECEIVABLES, OUTPUT_CGST, TDS_PAYABLE…). Automatic postings find accounts by this key, so the code and name can change freely. These accounts can't be archived, and their type can't change.
- **Control accounts.** Receivables, payables, staff advances and reimbursements payable are control accounts. Only their documents (invoices, bills, receipts, claims) post to them. Manual and opening-balance journals can't, so a control account's balance always equals the open items behind it.
- **Changing an account.** Name, code and description can always change. The heading can change only while nothing is posted to the account, so past statements never move. An account can be archived once its balance is zero and no draft uses it.

## Periods

Books are kept in monthly periods. The financial year starts in April for Indian entities and in January elsewhere (`finance_settings.fiscalYearStartMonth`). The first time anything is dated in a financial year, its twelve periods are created. Nothing posts into a closed period. Closing and reopening periods arrive with period close.

## Journals

A journal is a date, a narration and two or more lines. Each line is a debit or a credit in the base currency. Lines can also record the original currency amount and rate, the party (client, vendor or person) and the project.

    DRAFT ──post──▶ POSTED ──reverse──▶ a mirror-image REVERSAL journal
    DRAFT ──discard──▶ DISCARDED

- **Posting** checks the journal (at least two lines, debits equal credits, active accounts of this entity, control accounts only from documents, an open period). It then gives the journal its number from the entity's journal series (`JV/2627/00001`) and stamps the period.
- **Documents** call `postJournal(tx, caller, …)` inside their own transaction, so a document and its journal commit together or not at all. An idempotency key (for example `sales_invoice:<id>`) makes a retried posting return the first journal instead of posting twice.
- **Corrections** never edit a posted journal. A manual journal is reversed with a mirror-image journal on a date the user picks, and each journal can be reversed once. Journals that come from documents are corrected through the document (a credit note, a voided receipt), so the document and the ledger stay in step.
- **Manual journals** (Finance → Journals) are for adjustments, accruals, depreciation and opening balances. Drafts may be unbalanced while they are worked on. `finance.create` drafts, `finance.edit` changes or discards, `finance.post` posts and `finance.void` reverses.

### What the database enforces

The application checks give readable messages. The database still refuses a broken ledger if a bug or a direct query gets past them (migration `20261023130000_ledger`):

- A line is a debit or a credit, never both and never negative.
- A journal is created as a draft. Moving it to posted fails unless it balances, has at least two lines, matches its stored total, uses only its own entity's accounts and lands in an open period that contains its date.
- A posted or discarded journal, and its lines, can't be updated or deleted.

## Reports

- **Trial balance** (Finance → Trial balance): every account's balance as at a date, from posted journals, in debit and credit columns. If the columns ever differ, the screen says so in red instead of hiding it.
- **Account ledger** (click an account): the postings between two dates, with the balance brought forward and a running balance on the account's normal side.
- **Overview**: cash and bank, receivables, payables, and income and expenses to date.

## Permissions

Everything is scoped to the legal entity: `finance.view` reads the books, and `finance.configure` changes the chart and the finance settings. Project managers, sales and viewers without a finance grant can't see any of it.
