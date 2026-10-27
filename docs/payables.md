# Vendors, bills, payments and payables

Suppliers, their invoices, what HMBL pays them, and what is still owed (spec §11, "Accounts payable" and "Vendor bills"). The services are `src/server/vendors/service.ts`, and `bills.ts`, `payments.ts` and `payables.ts` in `src/server/finance/`. TDS arithmetic is in `src/lib/tds.ts`, with unit tests. Screens are under Finance → Bills, Payments, Payables and Vendors, and a project's page lists the bills waiting for its manager's approval.

## Vendors

A vendor is shared by every entity, like a client. It holds the GSTIN, PAN, Udyam (MSME) number, address, currency, payment terms, usual TDS section and rate, and bank details. The PAN is taken from the GSTIN when it is left blank, and the two must agree. Finance and procurement both keep vendors; only Finance changes bank details and TDS ([procurement.md](procurement.md)). A bill line can bill a purchase order line, which limits it to what was received or ordered and draws down the order's commitment.

## Bills

    DRAFT ──submit──▶ SUBMITTED ──approve──▶ APPROVED ──void──▶ VOIDED
      ▲                  │ send back
      └──────────────────┘
    DRAFT ──discard──▶ DISCARDED

Finance enters the supplier's invoice as a draft bill: their invoice number and date, the due date, currency and rate, how GST applies, TDS, and lines. Each line has an account (an expense, fixed asset or current asset account), a GST rate, whether its input GST can be claimed, and optionally a project and one of its budget lines. A new bill takes the vendor's currency, terms and usual TDS.

- **GST** follows the supplier's state against ours: the same state is CGST + SGST, another state IGST, outside India none. GST that can't be claimed (staff meals, for example) is added to the line's cost.
- **TDS** is worked out on the value before GST and rounded to the rupee (section 288B). It is only deducted on bills in the base currency. The bill's amount to pay is its total less TDS.
- **MSME suppliers** must be paid within 45 days (MSMED Act, section 15): a new bill's terms are capped at 45 days and a later due date is refused.
- **Duplicates**: the same supplier invoice number from the same vendor can't be submitted or approved twice in an entity.

Finance submits the bill (`finance.submit`). It is approved by the **project manager of every project on it**, or by Finance (`finance.approve`) when it has no project or the manager is away. A project manager sees only the bills they are asked to approve, from their project's page, without seeing the books. Either can send it back to draft with a reason.

Approval numbers the bill (`VB/{FYY}/{SEQ:5}`) and posts it on the bill date:

| Line                                        | Debit                                            | Credit       |
| ------------------------------------------- | ------------------------------------------------ | ------------ |
| Each line's account, with its project       | Value before GST, plus GST that can't be claimed |              |
| Input CGST (1310), SGST (1311), IGST (1312) | GST that can be claimed                          |              |
| TDS payable (2200), party: vendor           |                                                  | TDS withheld |
| Trade payables (2000), party: vendor        |                                                  | What is owed |

Foreign-currency bills are converted at the bill's rate, and payables balance the journal so rounding never unbalances it. Each project line is recorded as an **actual cost** on its budget line, in the project's currency, with the bill as its source. That cost can only be undone by voiding the bill. A line can also name a commitment on its budget line, such as a crew booking's; its actual cost then draws that commitment down, so the cost isn't counted twice. Crew settlements draft bills like this (see [crew.md](crew.md)).

An approved bill with nothing paid on it can be voided (`finance.void`) on a date with a reason: its journal is reversed and its project costs voided. A database trigger refuses any other change to an approved bill or its lines.

## Payments

    POSTED ──void──▶ VOIDED   (journals reversed, allocations released)

The mirror of a receipt. A payment is posted when it is recorded (`finance.post`): payables are debited and the bank or cash account credited. It settles approved bills of the same vendor and currency, then or later; what isn't set against a bill is an **advance** to the vendor, a debit on their payables. Payments are numbered `PAY/{FYY}/{SEQ:5}`.

Each allocation keeps the payable it clears at the **bill's rate** and the same money at the **payment's rate**. When paying costs more rupees than the bill was booked at, the difference is an exchange loss (6100); fewer, an exchange gain (4910). Taking everything a bill still owes takes the exact base remainder, so a settled foreign-currency bill leaves nothing behind. A database trigger refuses an allocation that overpays a bill or uses more than the payment has.

A payment returned by the bank or recorded in error is voided on a date: its journals are reversed and the bills it paid are open again.

## Payables

Finance → Payables shows what each vendor is owed at the end of a chosen date, in the base currency as posted, by days past due: not yet due, 1–30, 31–60, 61–90, over 90. Advances reduce the vendor's total. Allocations and voids count from their own dates. The total always equals the credit balance of trade payables on that date, and the page says so.

### TDS payable

The same page lists TDS withheld this financial year by month and section, with the date it must be deposited: the 7th of the following month, or 30 April for March. Vendors without a PAN are flagged, since TDS on them is due at 20% (section 206AA). The TDS payable balance is shown beside it; it falls as the tax is deposited, which is recorded as a journal until challans are tracked.

## Not covered yet

- **Reverse charge (RCM)** on imports of services and from unregistered suppliers: bills from outside India carry no GST, and self-invoicing under RCM is left to the accountant for now.
- TDS challans and the quarterly 26Q return.
