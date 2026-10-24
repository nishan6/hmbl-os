# Invoices and credit notes

Sales invoices bill clients and post to the ledger (spec §11, "Accounts receivable"). The services are `src/server/finance/invoices.ts` and `credit-notes.ts`. The GST arithmetic is in `src/lib/gst.ts`, document pricing in `src/lib/invoice.ts` and currency conversion in `src/lib/fx.ts`, all with unit tests. Screens are under Finance → Invoices and Finance → Credit notes. The client copy is `/print/invoices/<id>` and `/print/credit-notes/<id>`, which the browser prints or saves as PDF.

## Lifecycle

    DRAFT ──issue──▶ ISSUED      (numbered, posted, frozen)
    DRAFT ──discard──▶ DISCARDED

- **Starting.** An invoice is for one client, optionally for one of the client's projects in the same entity. Choosing a billing milestone starts the draft with one line for the milestone's share of the contract value at the default GST rate, and takes the milestone's due date.
- **Drafting.** Each line has a description, a SAC code (default `998596`, event services), quantity, rate, GST rate and the income account it credits. Totals are recalculated from the lines on every save.
- **Issuing** (`finance.issue`) takes the next number from the entity's `sales_invoice` series (`INV/2627/00001` by default, see [Invoice numbers](#invoice-numbers)), copies the client's and the entity's names, addresses and GSTINs onto the invoice, and posts the journal in the same transaction. An issued invoice can't change: a database trigger refuses any edit except recording revenue recognition once.
- **Correcting** is by credit note, never by editing or cancelling the invoice.

Finance creates and issues invoices. There is no approval step before issuing.

## Proforma, commercial and tax invoices

HMBL bills in up to three steps, and all three take their numbers from the same `sales_invoice` series (Nishan, 2026-10-24):

| Type               | Used for                                                      | Posts to the ledger                       |
| ------------------ | ------------------------------------------------------------- | ----------------------------------------- |
| Proforma invoice   | An estimate of the bill before the work                       | No                                        |
| Commercial invoice | Sent so the client pays, GST included, before the tax invoice | No                                        |
| Tax invoice        | The GST invoice, sent once the client has paid                | Yes: receivable, income and GST, as below |

The type is chosen when the invoice is started (`kind` on `sales_invoices`, default `TAX`). A proforma or commercial invoice is drafted, numbered and frozen like a tax invoice, but issuing it posts nothing, so it is never owed: it has no receivable, no outstanding amount, and receipts and credit notes can't point at it. Money the client pays against a commercial invoice is recorded as a receipt without allocation, which waits as a client advance until the tax invoice is issued and the receipt is allocated to it.

**Make tax invoice** (or **Make commercial invoice** from a proforma) on an issued invoice drafts the next type with the same client, project, service and lines, dated today, linked back to its source (`makeInvoiceFrom`, `finance.create`). It gets its own number when issued. Each invoice becomes each later type at most once; a unique index on `(sourceInvoiceId, kind)` enforces it. The database also refuses a tax invoice issued without its journal, an earlier type with one, and a receipt allocation or credit note against anything but a tax invoice.

Only tax invoices count in receivables, the receipts screen, the finance dashboard's drafts and the period-close checklist.

## Invoice numbers

HMBL's own format is `{FYS}-{CLIENT}-{SERVICE}-{CSEQ:2}-{SEQ:2}`, e.g. `26-MAG-VLR-03-08`: FY 2026-27, Magnanimous, a rental, MAG's third invoice and the eighth overall. See [numbering](numbering.md) for the tokens.

- **Client code** (`{CLIENT}`) is the client's _Invoice code_ on the client record (2–6 capitals or digits, unique among active clients). Clients without one are one-off clients and share `INT`, so they share one per-client count too. No client may hold `INT` itself.
- **Service** (`{SERVICE}`) is picked on each invoice from the entity's invoice services (Finance → Settings → Invoice services, `finance.configure`), e.g. `VLR` rental service and `LDS` live design services. A service's code never changes once added; archive it to stop using it.
- An invoice whose number needs a service can't be issued without one, and nothing is used up when it's refused.

## GST

The entity's GST state comes from its active GSTIN registration, or its address when it has none. The place of supply defaults to the client's state (from the client's GSTIN, else their address) and can be changed on the draft.

| Entity | Place of supply          | Supply type   | Tax                                  |
| ------ | ------------------------ | ------------- | ------------------------------------ |
| India  | Same state as the entity | `INTRA_STATE` | CGST + SGST, each half the rate      |
| India  | Another Indian state     | `INTER_STATE` | IGST                                 |
| India  | Outside India            | `EXPORT`      | IGST at the line's rate (often zero) |
| Abroad | Anywhere                 | `NON_GST`     | One VAT or sales tax amount          |

HMBL Group's GSTIN is in Assam (state code 18), so Assam clients get CGST and SGST and everyone else in India gets IGST. Tax is worked out per line and per component, rounded half away from zero. CGST and SGST are each rounded from half the rate, so they are always equal. Document totals are the sums of the lines and are never re-rounded. An Indian entity can't issue a tax invoice until it has a GSTIN.

The printed tax invoice shows the supplier's and the client's GSTIN (or "Unregistered"), the place of supply with its state code, SAC codes, taxable value and each tax component with its rate, and the amount in words for INR.

## What an invoice posts

Amounts are converted to the entity's base currency at the invoice's rate (entered on the draft as base currency per unit, up to 8 decimals). Receivables is the balancing line, so rounding in conversion never unbalances the journal.

| Line                                    | Debit | Credit         |
| --------------------------------------- | ----- | -------------- |
| Trade receivables (1200), party: client | Total |                |
| Each line's income account              |       | Taxable value  |
| Output CGST / SGST / IGST (2100–2102)   |       | Each component |

Under revenue recognition **on completion** (Finance → Settings), an invoice for a project credits Advances from clients (2300) instead of income. Once the project is completed, "Recognise revenue" posts a second journal moving the amount, less anything credited, from advances to each line's income account.

## Credit notes

A credit note is against one issued invoice. Each of its lines credits part of one invoice line's taxable value, with tax at that line's rate and the invoice's supply type and exchange rate. It can't credit more than is left on a line, nor more than the invoice still has outstanding. Both are checked again under a row lock when it is issued, so two credit notes issued at once can't over-credit. Issuing numbers it from the `credit_note` series (`CN/2627/00001`) and posts the mirror image of its share of the invoice: income (or client advances, while revenue is still deferred) and output tax are debited, and receivables credited.

## Outstanding and status

Invoiced, credited and received stay separate figures. Outstanding is total less issued credit notes less receipts allocated (receipts arrive with the next part of Stage 4). An issued invoice shows as Due, Overdue (past its due date), Partially paid, Paid, or Credited (cleared by credit notes alone).
