# Estimates and quotes

A quote is a structured, versioned commercial record (spec §9), not a PDF with a total. Domain code is in `src/server/commercial/`; the calculations are in `src/lib/pricing.ts`, shared by the server and the editor.

## Records

| Model          | Holds                                                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `Quote`        | Number (from the entity's `quotation` scheme), legal entity, client, optional opportunity, title, owner, latest version number          |
| `QuoteVersion` | Status, contact, currency and exchange rate, validity, payment schedule, default tax, contingency, PO requirement, event, terms, totals |
| `QuoteLine`    | Category, description, pricing method, quantity, days, unit, cost, rate, markup or margin, discount, tax, and the calculated amounts    |

Quotes belong to a legal entity and are checked against it (`commercial.*` with `{ legalEntityId }`). A quote outside the actor's entities is reported as not found.

Payment terms, unit codes and tax rates are **copied onto the quote** when chosen, so changing master data later never changes a quote already written.

## Pricing

Every line has a pricing method. Nothing about the method is hard-coded into the tables.

| Method               | Selling amount                        |
| -------------------- | ------------------------------------- |
| Rate × quantity      | quantity × days × rate                |
| Fixed price          | the price, once                       |
| Cost plus markup (u) | quantity × days × unit cost × (1 + u) |
| Cost plus margin (m) | quantity × days × unit cost ÷ (1 − m) |

Definitions are used the same way everywhere and the editor states which is which:

- **Markup** = (price − cost) ÷ cost
- **Margin** = (price − cost) ÷ price

Then, per line: discount (a percentage of the selling amount), then tax on the discounted amount. The quote's **subtotal** is the sum of discounted line amounts; **contingency** is a client-visible percentage of the subtotal, taxed at the quote's default rate; **total** = subtotal + contingency + tax.

Validation refuses what can't be priced: quantity or days of zero, negative amounts, a margin of 100% or more (it would need an infinite price), markup above 1000%, and cost-plus pricing without a cost. The database repeats these as CHECK constraints.

Money is integer minor units, quantities are thousandths, percentages are basis points; no floating point is involved. Each derived amount is rounded once, half away from zero, so line amounts always add up to the totals. `splitByPercent` splits an amount into instalments with the remainder on the last.

## Saving

`saveDraft` takes the whole draft (details and every line), prices it on the server, stores the totals and audits the changes. The editor's live totals are only a preview. Rules:

- Only the latest version, while it is a **draft**, can be saved.
- A save carries the version's `updatedAt` as loaded; if someone saved in between, it is refused rather than overwriting their work.
- Line errors come back by row and field (`lines.2.unitPrice`), and the editor highlights them.

Once a version leaves draft, a database trigger refuses any change to it other than its status, and any change to its lines, whatever code tries.

## Who sees what

| Role                    | Quotes                                                                       |
| ----------------------- | ---------------------------------------------------------------------------- |
| Owner / Director        | Everything                                                                   |
| Sales                   | Create and edit drafts; sees cost, margin and internal notes                 |
| Finance                 | View, including cost and margin (`commercial.view_sensitive`)                |
| Project manager, Viewer | View selling prices only; cost, margin, markup and internal notes are hidden |

## Screens

- `/quotes`: every quote, searchable by number, title or client, filtered by the entity picker.
- `/quotes/new`: start a quote, usually from an opportunity ("New quote" on the opportunity or client page). Currency, event dates and venue come from the opportunity; tax and payment terms from the defaults.
- `/quotes/[id]`: the version's details, lines, totals, payment schedule and version list. `?version=N` shows an earlier version.
- `/quotes/[id]/edit`: the line editor with live totals.

Submitting for approval, issuing, revisions, the printable quote and acceptance come in the next stages of this work.
