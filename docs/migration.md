# Financial migration

How an entity's books come over from the old system (for example Tally) at a cut-over date (spec §23). The page is Finance → **Opening balances** (`/finance/opening-balances`); the service is `src/server/finance/opening.ts`. Records (clients, vendors, crew, equipment) come first, through [record imports](imports.md).

## The plan

1. **Pick the cut-over date**: usually the last day of a month, after the old system's month is closed. Balances are as at the end of that day; HMBL OS keeps the books from the next day.
2. **Import the records** that the open invoices and bills refer to: clients and vendors, under Administration → Imports.
3. **Settle what can't come over** in the old system before cut-over: staff advances and reimbursements payable are control accounts whose documents (claims, advances) aren't migrated, so their balances must be zero, or brought in later as new claims or advances.
4. **Back up** (`pnpm db:backup`, see [running-locally.md](running-locally.md)) and keep that file as the cut-over backup.
5. **Enter the cut-over** on Opening balances: the date, the old system's name, and from its own reports on that date, in the base currency: total debits of the trial balance, trade receivables (sundry debtors), trade payables (sundry creditors), and the number of open invoices and bills.
6. **Import three CSV files** (templates are on the page):
   - **Trial balance**: Account code, Debit, Credit, Description. Every balance except receivables and payables, using HMBL OS account codes (map the old ledger names to the chart first). Zero balances are left out.
   - **Open invoices**: Client, Invoice number, Invoice date, Due date, Currency, Amount due, Exchange rate. What each client still owed on each invoice. The client is found by invoice code, name or legal name. The exchange rate (base currency per unit) is the old system's, and is needed only for foreign-currency invoices.
   - **Open bills**: Vendor, Bill number, Bill date, Due date, Currency, Amount due, Exchange rate. The vendor is found by GSTIN, name or legal name.

   Each file is checked all or nothing. A file with any problem saves nothing and lists every problem with its line. A new file replaces the earlier one of its kind.

7. **Reconcile.** The page compares the totals with the old system's: trial balance debits (including receivables), receivables, payables and the two counts. Debits must equal credits, and nothing may already be posted on or before the cut-over date. **Post** is offered only when every check agrees.
8. **Post** (`finance.post`). In one transaction:
   - Each open invoice is issued as an opening invoice under its old number, with one line for the balance, no tax and its own journal (Dr receivables for the client, Cr opening balance equity 3900).
   - Each open bill is approved as an opening bill, numbered `OB-0001` onwards with the supplier's number kept, with its own journal (Dr 3900, Cr payables for the vendor).
   - One journal posts the account balances and takes the net of receivables and payables back out of 3900, so it ends where the old system had it.
   - All are dated the cut-over day, with source "Opening balances".
9. **Check** the trial balance, receivables and payables reports against the old system's on the cut-over date, then switch the old system to read-only.
10. **Set the number counters** (Administration → Numbering) to carry on after the old system's last invoice number, so new invoices don't collide with opening invoices.

## After posting

Opening invoices and bills behave like any other: receipts and payments are allocated to them, they age in receivables and payables, and overdue reminders cover them. They are marked as opening balances on their pages. An opening invoice has no printable copy and isn't shown in the client portal, because HMBL OS didn't issue it. Opening invoices are left out of invoiced revenue on the executive dashboard.

Posted books don't change. To correct:

- **A wrong opening invoice**: issue a credit note against it. It credits the client and debits opening balance equity, since the line is against 3900.
- **A wrong opening bill**: void it. The reversal goes back through 3900.
- **A wrong account balance**: a manual journal between the account and 3900.

Any balance left on 3900 afterwards shows how far the corrections moved the books from the old system, for the accountant to clear.

## Rolling back

Before anyone has worked in HMBL OS after the cut-over, the clean rollback is to **restore the cut-over backup** (see "Restore a backup" in [running-locally.md](running-locally.md)). That undoes the posting and everything else since the backup. Fix the files, then post again. After people have started working, correct instead of restoring.

## Audit

The draft and the posting are audited against the opening balance (`opening_balance.started`, `.updated`, `.file_imported`, `.posted`). Each journal is audited as `journal.posted`.
