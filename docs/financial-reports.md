# Financial reports and the finance dashboard

Statements built from posted journals (spec §11, "Financial reporting", and §21, "Finance dashboard"). The services are `statements.ts`, `dashboard.ts` and `report-export.ts` in `src/server/finance/`. Finance works from Finance → **Reports**; the Finance overview is the dashboard. Everything needs `finance.view` for the entity; downloading CSV also needs `reports.export`.

Every figure is a sum of posted journal lines in the entity's base currency. Drafts never count. So each statement agrees with the trial balance on the same dates, and a statement that doesn't add up says so on the page instead of hiding it.

## Reports

| Report                | Dates   | What it shows                                                                                                                                                                                                                    |
| --------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profit and loss       | From–to | Revenue, direct costs, gross profit, operating expenses, operating profit, other income, net profit. Optional comparison with the period just before or the same dates last year. Optional project: only lines tagged with it.   |
| Balance sheet         | As at   | Cash and bank, receivables, other current and fixed assets; payables, other current and long-term liabilities; equity. See "Profit in equity" below.                                                                             |
| Cash flow             | From–to | Opening cash and bank, money in and out by operating, investing and financing activity, closing cash and bank. See "Cash flow" below.                                                                                            |
| Trial balance         | As at   | Every account's balance as a debit or credit (built in Stage 4 PR 1).                                                                                                                                                            |
| GST and TDS summary   | From–to | By month: GST charged (output CGST, SGST, IGST), GST claimed (input), net GST, TDS deducted by clients and TDS deducted from vendors, and the total of each tax account. A working summary for the accountant, not a GST return. |
| Project profitability | From–to | Revenue, direct costs, margin and margin % per project, from journal lines tagged with the project. Overheads aren't allocated. Each project links to its own profit and loss.                                                   |

Receivables and payables ageing, TDS payable and staff balances are listed on the same Reports page.

Dates default to the financial year to date. Each account line links to its ledger for the same dates.

**Profit in equity.** HMBL OS doesn't post year-end closing entries. The balance sheet shows two lines under equity: profit for the financial year to date, and profit of earlier years not yet moved to retained earnings by a journal. Assets therefore always equal liabilities plus equity. To move last year's profit into retained earnings, post a manual journal; the "earlier years" line falls by the same amount.

**Cash flow.** This uses the direct method. Each posted journal that touches a cash or bank account is split by its other lines. Cash that came in with a credit to receivables is money from clients, cash paid out with a debit to bank charges is a bank charge, and so on. Each line is then classed by its account:

- fixed assets are investing;
- long-term liabilities and equity are financing;
- everything else is operating.

Moves between the company's own cash and bank accounts aren't cash flows and cancel out. Opening cash plus the net flow always equals closing cash.

## Downloading

Each report has **Download CSV**, served by `/api/finance/reports/{report}` with the same dates. Amounts are plain numbers with two decimals in the base currency, ready for a spreadsheet or the accountant's software. Text cells that start with `=`, `+`, `-` or `@` are prefixed with an apostrophe so a spreadsheet can't run them as formulas.

## Finance dashboard

Finance → Overview shows, for the chosen entity, today:

- **Needs attention.** Receivables, payables or staff balances that don't agree with their ledger accounts. A suspense balance. Receivables over 90 days. Bank statement lines unmatched for more than 30 days.
- **Money owed.** Receivables and payables totals, the overdue amount, and the ageing buckets.
- **Cash and bank.** Each bank account's balance in the books, how far it is reconciled and how many statement lines are waiting to be matched, plus the cash accounts.
- **Waiting.** Drafts (journals, invoices, credit notes, bills), bills and expense claims waiting for approval, approved claims not yet paid, and advances not yet settled.
- **Period close.** The last closed month and the past months still open.
- **Recent journals.**

## Not covered yet

- Consolidated views across entities, and intercompany eliminations.
- Budget against actual in finance reports (projects show it on their budget page).
- Charts.
- Unrealised exchange gains and losses on foreign balances at a reporting date.
