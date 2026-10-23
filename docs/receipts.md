# Receipts, bank accounts and receivables

Money from clients, the invoices it settles, and what is still owed (spec §11, "Accounts receivable"). The services are `src/server/finance/receipts.ts`, `bank-accounts.ts` and `receivables.ts`. The settlement arithmetic is in `src/lib/settlement.ts`, with unit tests. Screens are under Finance → Receipts, Receivables and Bank accounts.

## Bank accounts

Each bank account has its details (bank, account number, IFSC or SWIFT/IBAN, currency) and its own ledger account under the Bank heading, numbered from 1100. Cash accounts are ordinary Cash accounts in the chart (1000 Cash in hand, 1010 Petty cash). A bank account marked "print on invoices" appears as payment details on invoices in its currency. Its currency can't change once anything is posted to it.

## Receipts

    POSTED ──void──▶ VOIDED   (journals reversed, allocations released)

A receipt is posted when it is recorded (`finance.post`). It records the client, the bank or cash account the money went into, the date, the method and reference (UTR, cheque or UPI number), the amount, and any **TDS** the client deducted with its section (194C, 194J…). TDS counts towards settling invoices like money received, because the client pays it to the government on HMBL's behalf; it is claimed back against HMBL's income tax.

The receipt is in the currency of the account it went into, and only settles invoices in that currency. A foreign-currency receipt takes its own exchange rate. TDS is only recorded on receipts in the base currency.

| Line                                    | Debit           | Credit                                |
| --------------------------------------- | --------------- | ------------------------------------- |
| Bank or cash account                    | Amount received |                                       |
| TDS receivable (1300), party: client    | TDS deducted    |                                       |
| Trade receivables (1200), party: client |                 | Each invoice settled, at its own rate |
| Trade receivables (1200), party: client |                 | What is left, on account              |
| Exchange gains (4910) or losses (6100)  | Loss            | Gain                                  |

### Allocations

Part of a receipt applied to one invoice is an allocation. A receipt can be allocated when it is recorded, or later from the receipt's page; what is not allocated stays **on account** against the client. An allocation can't be more than the invoice still owes or more than the receipt has left, and both are checked again by a database trigger.

Each allocation keeps two base-currency amounts: the receivable it clears **at the invoice's rate**, and the same money **at the receipt's rate**. The difference is the exchange gain or loss. It is posted with the receipt, or as its own journal when on-account money is allocated later. When an allocation takes everything an invoice still owes, it takes the exact base remainder rather than converting again, so a settled foreign-currency invoice leaves nothing behind from rounding. The same applies on the receipt side.

### Voiding

A receipt recorded in error, or a bounced cheque, is voided (`finance.void`) on a date with a reason. Its journal and any exchange-difference journals are reversed on that date, its allocations are released, and the invoices it settled are open again. The receipt stays, marked voided. A database trigger refuses any other change to a receipt or an allocation, and any delete.

## Invoice status

An issued invoice's outstanding amount is its total, less issued credit notes, less live allocations. Credit notes can't take an invoice below what has been received.

## Receivables ageing

Finance → Receivables shows what each client owes at the end of a chosen date, in the base currency as posted. Each invoice's outstanding amount is put in a bucket by days past its due date: not yet due, 1–30, 31–60, 61–90, over 90. Money on account is shown against the client and reduces their total. Credit notes, allocations and voids count from their own dates, so an earlier date shows the position as it was then.

The total always equals the balance of the receivables account on that date, and the page says so. A difference would mean something posted to receivables outside invoices, credit notes and receipts, which the control-account rules prevent.
