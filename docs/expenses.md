# Expense claims and advances

Money staff and crew spend for work and claim back, and money given to them before they spend it (spec §11, "Expenses and advances"). The services are `claims.ts` and `categories.ts` in `src/server/expenses/`, and `advances.ts` and `expense-settlements.ts` in `src/server/finance/`. Everyone with `expenses.view` sees **Expenses** in the navigation; Finance works from Finance → Expense claims, Advances and Staff balances. A project's page lists the claims waiting for its manager.

## Categories

Every claim line has a category, shared by all companies. A category names the ledger account it posts to by **code**, so the same category works in every company's chart; a per-line limit in rupees; and whether a receipt is needed. The defaults are a labelled starting point (see [decisions.md](decisions.md), "Expense limits"):

| Category                            | Account | Limit per line | Receipt |
| ----------------------------------- | ------- | -------------- | ------- |
| Travel (flights, trains, buses)     | 5030    | None           | Needed  |
| Local conveyance (taxi, auto, fuel) | 5030    | ₹2,000         | No      |
| Accommodation                       | 5040    | ₹8,000         | Needed  |
| Meals                               | 5040    | ₹1,500         | Needed  |
| Courier and freight                 | 5050    | None           | Needed  |
| Permits, parking and venue fees     | 5060    | None           | Needed  |
| Site purchases and consumables      | 5090    | ₹10,000        | Needed  |
| Office expenses                     | 6070    | ₹5,000         | Needed  |

Finance changes them in Finance → Settings (`finance.configure` for every entity).

## Claims

    DRAFT ──submit──▶ SUBMITTED ──approve──▶ APPROVED ──void──▶ VOIDED
      ▲                  │ send back
      └──────────────────┘
    DRAFT ──discard──▶ DISCARDED

A claim belongs to one person and one company, in that company's base currency. Each line has a date (not in the future), a category, a description, who was paid, the amount, and optionally a project and one of its budget lines. Money spent abroad is entered at the rupees it cost, with the foreign amount alongside for reference. Receipts are photos or PDFs uploaded to the claim and attached to a line; they stream to disk like project documents and can't be deleted, and they stay on their line when the draft is edited.

**Policy.** A line over its category's limit, or without a receipt its category needs, must say why before the claim can be submitted. Approvers see those lines flagged.

**Approval.** The project manager of every project on the claim approves it, or Finance (`finance.approve`). **Nobody approves their own claim**, Finance included. Either approver can send it back with a reason. A project manager sees only the claims they are asked to approve, without seeing the books.

Approval posts the claim on its **latest expense date**:

| Line                                           | Debit       | Credit      |
| ---------------------------------------------- | ----------- | ----------- |
| Each line's category account, with its project | Line amount |             |
| Reimbursements payable (2220), party: claimant |             | Claim total |

Project lines are recorded as **actual costs** on their budget lines, with the claim as their source. GST on staff expenses is not claimed as input tax; it stays in the cost.

An approved claim with nothing settled on it can be voided (`finance.void`): its journal is reversed and its project costs voided. Database triggers refuse changes to an approved claim and its lines.

## Advances

    POSTED ──void──▶ VOIDED   (only while nothing is settled or returned)

Finance pays an advance to a person (`finance.post`), numbered `ADV/{FYY}/{SEQ:5}`, optionally for a project, from a bank or cash account in the base currency:

| Line                                        | Debit  | Credit |
| ------------------------------------------- | ------ | ------ |
| Advances to staff (1400), party: the person | Amount |        |
| Bank or cash                                |        | Amount |

Unspent money handed back is recorded on the advance (Dr bank or cash, Cr advances to staff).

## Settling a claim

Finance clears what an approved claim owes, in any mix and on any date from its posting:

- **From an advance** of the same person, company and currency: Dr reimbursements payable / Cr advances to staff.
- **By paying it** from a bank or cash account: Dr reimbursements payable / Cr bank or cash.

A settlement recorded in error is voided on a date, reversing its journal; the claim is owed again. Database triggers refuse settling more than a claim owes or using more of an advance than is left.

## Staff balances

Finance → Staff balances shows, for the end of a chosen date, the unspent advances each person holds and the approved claims still owed to them, and the net to pay or recover. Postings, settlements, returns and voids count from their own dates. The totals always equal the debit balance of advances to staff and the credit balance of reimbursements payable on that date, and the page says so.

## Not covered yet

- Mileage at a per-kilometre rate and daily allowances (per diems).
- Claims in a currency other than the company's base currency.
- Paying several claims in one bank transfer.
- Corporate cards.
