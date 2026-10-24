# Vendor and freelancer portal

What vendors and freelancers see and do in the portal (spec §19). Access itself is in [portal.md](portal.md). The services are `src/server/portal/vendor.ts`, `freelancer.ts`, `profile.ts` and `activity.ts` (what staff see of it); the pages are under `src/app/portal/`.

## Kept to their own records

- Every query takes the vendor or the crew record from the portal account, never from the request. Ids that aren't theirs, or aren't ids, read as not found.
- Each service checks the account's kind as well as its permission, so a vendor can't reach a freelancer's pages, a freelancer can't reach a client's, and so on.
- Database triggers (`portal_vendor_record_guard`) refuse an answer, upload or details request for anything outside the account's own organisation, even if the code were wrong. All of these records are append-only.
- A freelancer sees only their own bookings, with their own rate, call time and who to report to. Never other crew, project budgets or costs, internal notes or employee records.
- A vendor sees only orders to them, as HMBL last approved them.

## Vendors

| Permission       | What they can do                                                                                                                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `orders.view`    | See orders once approved: lines, prices, tax, hire dates, delivery and terms, from the stored approved revision. Never drafts, unapproved amendments, internal notes or budget links.            |
| `orders.confirm` | Confirm or decline (with a reason) the current approved revision, once. A new approved revision can be answered again. While HMBL amends an order, it can't be answered.                         |
| `bills.submit`   | Upload their invoice for an order, with its number, date and total. The file goes on the order's documents and Finance is told; Finance enters the bill as usual. One upload per invoice number. |
| `payments.view`  | See bills once HMBL has entered and submitted them, with TDS, what was paid and what is still due. Drafts are never shown.                                                                       |
| `profile.edit`   | Change their email, phone and address directly. Tax, bank and compliance details are sent as a request that procurement checks and applies.                                                      |

## Freelancers

| Permission          | What they can do                                                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `work.view`         | See their bookings: project, venue, dates, role, call time, who to report to and their own rates.                                                                                                                                     |
| `work.confirm`      | Answer a proposed booking. **Yes** tells the coordinator and project manager, and the booking stays proposed until HMBL confirms it (clashes and budget are HMBL's to check). **No** needs a reason and ends the booking as declined. |
| `timesheets.submit` | Record a full or half day, overtime and expenses on a confirmed booking, within its dates. A day can be corrected until the project approves it. The project manager is told.                                                         |
| `settlements.view`  | See approved days waiting to be settled, and each settlement with TDS, what was paid and what is still due.                                                                                                                           |
| `profile.edit`      | Change contact details, where they are based and their emergency contact. Certifications, tax and bank details are sent as a request.                                                                                                 |

## Why details changes are requests

A portal sign-in must never be able to redirect a payment. Bank, PAN, GSTIN, MSME and TDS details, and certifications, are only changed by staff after checking. The request appears on the vendor's or crew member's page under **Changes asked for in the portal**, and procurement or crew coordinators are notified.

## What staff see

- The order page shows **From the vendor portal**: each answer and each uploaded invoice, with who and when. The invoice file is in the order's documents.
- The booking page shows **Their answer in the portal**.
- The vendor and crew pages show the details requests.

## Notifications

`portal.supplier_activity`:

- whoever raised an order, when the vendor answers it
- the order's creator and Finance, when an invoice is uploaded
- the booking's creator and the project manager, when a freelancer answers
- the project manager, when a freelancer records a day
- procurement or crew coordinators, when details changes are requested

## Audit

`purchase_order.vendor_confirmed` and `.vendor_declined`, `vendor_invoice.uploaded`, `crew_assignment.freelancer_available`, `crew_assignment.declined`, `crew_work.recorded` and `.updated`, `vendor.updated` and `crew_member.updated` (with `via: "portal"`), and `portal_details.requested`. The actor is always the portal user.

## Demo

`vendor@demo.hmbl.test` sees the demo vendor's approved orders. `freelancer@demo.hmbl.test` has a confirmed booking and a proposed one on the demo project.
