# Bank reconciliation

Checking the books against the bank's own statement (spec §11, "Bank reconciliation"). The service is `src/server/finance/bank-reconciliation.ts`; CSV reading is in `src/lib/csv.ts` and `src/lib/bank-statement.ts`. Finance works from Finance → Bank accounts → an account → **Reconcile**.

Nothing is fetched from a bank and nothing is matched by itself. Statement lines come from a file the bank produced or are typed in, and every match is confirmed by a person (spec: "No automatic bank reconciliation based on fabricated data").

## Statement lines

Amounts are signed in the **bank account's currency**: money in positive, money out negative.

**Importing a CSV** (`finance.post`). Download the statement from the bank's website as CSV (save an Excel download as CSV first). The browser reads the file, finds the header row, guesses which column is which, works out how dates are written, and previews the transactions with their totals before anything is sent. Finance can change the header row, the last transaction row (banks put a summary underneath), the date format and each column. The amount is either one signed column or a withdrawal and a deposit column.

The server reads the file again and imports **nothing** if:

- any row in range can't be read (the first five problems are shown);
- a running balance column doesn't add up from one row to the next, in either date order, which usually means a row is missing;
- a line is dated on or before the last completed reconciliation;
- every line was imported before.

Lines already imported are recognised by date, amount, description and reference (numbered when the same line repeats in one file), so overlapping statements can be imported safely. Each import keeps the file name, its SHA-256 and the count imported and skipped.

**Typing a line in**, from a paper or PDF statement: date, description, reference, money in or out, amount. An unmatched line added in error can be removed. Statement lines are never edited.

## Matching

A statement line is matched to the ledger lines on the bank account that make it up, adding up to exactly its amount: one receipt, or several cheques banked together. A ledger line matches one statement line only.

**Likely matches** are ledger lines of the same amount within ten days. They are shown beside the line and pre-ticked when it is opened, and are not matched until Finance presses **Match**.

**Posting from a line.** Bank charges, interest and transfers the books don't have yet are posted from the statement line, on its date, to an account Finance chooses (not a control account, not the bank itself), and matched at once:

| Line               | Money in | Money out |
| ------------------ | -------- | --------- |
| Bank               | Debit    | Credit    |
| The account chosen | Credit   | Debit     |

The journal's source is BANK, so it shows in the general ledger like any other. On a foreign-currency account Finance gives the day's rate and the ledger line keeps the foreign amount.

A match can be undone until its line is reconciled.

## Reconciling

Finance enters the statement's date and closing balance and presses **Check**. The page shows:

- the balance in the books on the date,
- less what was paid in or out in the books but isn't on the statement yet,
- plus what is on the statement by the date but was booked in the books after it,
- which is what has **cleared through the bank** (every matched ledger line by then);
- the statement's closing balance, and the **difference** between the two.

A reconciliation is **completed** when every statement line on or before the date is matched and the difference is nil. Its statement lines, and their matches, are then locked: database triggers refuse adding or removing a statement line on or before the date, adding or removing a match on such a line, and changing a completed reconciliation. Reconciliations move forward in date.

**The first reconciliation.** Money that went through the bank before the first imported statement (for example the opening balance journal) is marked **cleared before the first statement** from the list of ledger lines not yet at the bank. These opening items are fixed once the account is first reconciled.

**Reopening** (`finance.void`, with a reason) unlocks the latest completed reconciliation so a wrong match can be corrected; it is then completed again. Earlier ones are reopened in turn, latest first. Both are in the audit log.

## Foreign-currency accounts

A USD account is reconciled in dollars: each ledger line counts at its foreign amount. Ledger lines on the account without a foreign amount in its currency (none are posted by HMBL OS) are left out.

## Not covered yet

- Bank feeds or account aggregator connections.
- Rules that match recurring lines by themselves.
- Statements in OFX, MT940 or PDF form; save as CSV or type the lines in.
- Transfers between two of the company's own accounts matched on both sides in one step.
