# Period close

Locking a month's books once they are complete (spec §11, "Period close"). The service is `src/server/finance/period-close.ts`; Finance works from Finance → **Period close**.

Books are kept in monthly periods (see [ledger.md](ledger.md)). Nothing can be posted into a closed period. The database refuses it, so this also covers a document issued, approved, paid or voided with a date in that month.

## The checklist

Each open month has a checklist, worked out from the books when the page opens.

**Must be cleared before closing:**

- Every earlier month is closed. Months close in date order.
- No draft journals are dated in the month. Post them or discard them.
- The trial balance balances at the month end.

**Warnings, which can be accepted with a note:**

- Draft invoices or credit notes are dated in the month. After the close they must be dated later.
- Vendor bills dated in the month are not yet approved.
- Expense claims with expenses in the month are waiting for approval.
- A bank account with postings is not reconciled to the month end, or has unmatched statement lines in the month.
- The suspense account has a balance at the month end.

Each item links to where it is cleared. **New adjustment journal** opens a manual journal dated on the last day of the month, for accruals and corrections.

## Closing and reopening

**Closing** needs `finance.approve`. Blocking items stop it, and open warnings need a note saying why the month can close anyway. The close takes a lock on the period row, so a posting into the month either finishes first or is refused.

**Reopening** needs `finance.configure` and a reason. Only the latest closed month can be reopened. Earlier months reopen in turn, latest first. After the correction, close it again.

Each close and reopen records who did it, when, the note or reason, and the checklist as it stood. This record is the audit evidence, and the database never changes or deletes it. Both actions also go to the audit log.

## Database rules

- A period's dates never change, and periods are never deleted.
- A period can close only when every earlier period of the entity is closed. It can reopen only when every later one is open.
- A closed period records who closed it and when; an open one has neither.
- Close events can't be changed or deleted.

## Not covered yet

- Year-end closing entries. The balance sheet shows profit for the year without them (see [financial-reports.md](financial-reports.md)).
- A second person approving a close, or soft-closing a month for some modules only.
