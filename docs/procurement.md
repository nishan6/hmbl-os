# Procurement

Buying from vendors for a project or for overheads (spec §14): purchase orders, approval, amendments, receipts, rentals and billing. The services are in `src/server/procurement/`: `orders.ts` (the order lifecycle and receipts), `settings.ts` (the approval threshold), `billing.ts` (drafting a bill from an order) and `matching.ts` (checking bill lines against orders). The rules that need no database are in `src/lib/procurement.ts`, with unit tests. Screens are under Procurement: Purchase orders, Vendors and Settings.

## Vendors

Procurement and Finance keep the same vendor records ([payables.md](payables.md)). `procurement.create` and `procurement.edit` add and change a vendor's name, tax numbers, address, currency and terms. How a vendor is paid stays with Finance: only `finance.edit` changes bank details and TDS, and bank details are shown only to `finance.view` and `procurement.view_sensitive`. Archiving needs `procurement.archive` or `finance.edit`.

## Orders

An order is to one vendor, from one legal entity, for **either** a project **or** a cost centre. A project order needs the project's budget to be approved; its currency is the project's, and every line names one of the project's budget lines. A cost-centre order is in the vendor's currency and has no budget lines. Each order has a kind:

| Kind               | Billed up to    | Notes                                     |
| ------------------ | --------------- | ----------------------------------------- |
| Services           | What's ordered  | Receipts are optional                     |
| Rental             | What's received | Needs a hire period; returns are recorded |
| Consumables        | What's received |                                           |
| Equipment purchase | What's received |                                           |

Lines have a description, quantity (up to three decimals), rate and GST rate; GST follows the vendor's state against the entity's, as on bills. An order also carries the date it's needed by, where and how to deliver, terms and notes.

```
DRAFT ──submit──▶ SUBMITTED ──approve──▶ APPROVED ──close──▶ CLOSED
  ▲                  │reject               │amend
  └──────────────────┘                     ▼
                 APPROVED ◀──approve── AMENDING ──withdraw──▶ APPROVED
DRAFT / SUBMITTED / APPROVED (nothing received or billed) ──cancel──▶ CANCELLED
```

- **Submitting** (`procurement.submit`): an order whose subtotal before tax is above the entity's threshold waits for an approver; at or below it, it is approved there and then. Orders in another currency than the entity's always wait. The threshold is set per entity in Procurement → Settings (`procurement.configure`); until it is set it is zero, so every order waits.
- **Approving** (`procurement.approve`, held by Owner and Finance) numbers the order `PO/{FYY}/{SEQ:5}`, keeps this version as a revision, and commits each project line's amount to its budget line. Rejecting (`procurement.reject`) sends it back with a reason.
- **Amending** an approved order opens it for changes with a reason. While it is amended nothing can be received or billed against it. A line keeps its budget line, can't go below what has been received or billed, and can't be removed once anything was received or billed against it. An amendment that raises the subtotal is material and is approved like a new order; one that doesn't (a lower price, less quantity, new delivery details) applies when submitted. Withdrawing it restores the last approved version. Every approved version is kept, with its reason and approver.
- **Closing** (`procurement.edit`) ends an approved order and releases whatever wasn't billed from the project's commitments. It is refused while rented items are still out or a bill against the order is still a draft or awaiting approval.
- **Cancelling**: drafts by whoever edits orders; an approved order only by an approver, and only while nothing has been received or billed.

## Receipts and rentals

Whoever buys (`procurement.edit`) or keeps the warehouse (`equipment.edit`) records what arrived against an approved order, in part or in full, with the date, where it arrived and the delivery note. More than is still to come is refused. For rentals, handing items back to the vendor is recorded the same way, up to what is still on hire.

Rented equipment is not added to HMBL's own equipment pool or availability; the booking's shortfall reason records that it is being rented in.

## Billing

From an approved order, Finance (`finance.create`) drafts the vendor's bill: one line per order line for what can be billed now, at the order's rate and GST, on the order's budget line and drawing down its commitment. The account starts from the kind (services 5090, rentals 5010, consumables 5020, equipment purchases 1500) and can be changed. Finance enters the supplier's invoice number and checks it against their invoice. A bill can also be entered by hand; its lines can still point at order lines.

Every bill line that bills an order line is checked when the draft is saved and again, under a lock, when it is approved: same entity, vendor and currency; an approved order; the order's project and budget line; and no more than can be billed, less what other bills not discarded or voided already claim. The bill's actual cost draws down the order line's commitment, so the cost is counted once: committed on approval, actual on the bill, paid by the payment.

Cost entries are append-only. When an amendment changes a line, its commitment is ended and a new one posted for the new amount less what was already billed against the old one.

## Audit

Every change is recorded with its reason where one is given: `purchase_order.created`, `.saved`, `.submitted`, `.approved` (with `auto` when approved on submission), `.rejected`, `.amendment_started`, `.amendment_saved`, `.amendment_withdrawn`, `.received`, `.returned`, `.closed`, `.cancelled`; `procurement_settings.updated`; and the project's `project_cost.committed`, `.commitment_closed` and `.voided`.
