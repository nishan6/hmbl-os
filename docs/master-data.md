# Master data

Group-wide configuration that quotes and, later, invoices draw on. Documents copy the values they use (rate, label, instalments), so changing master data never rewrites an issued document.

| Record                                          | Who configures it                       | Notes                                                                                                                      |
| ----------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Tax rate (`tax_rates`)                          | `finance.configure` for every entity    | Per country. Rate in basis points (1800 = 18%). One default per country. Rates can't be edited: archive and add a new one. |
| Payment term (`payment_terms`, `…_instalments`) | `commercial.configure` for every entity | Instalments add up to exactly 100%. Each is due on acceptance, a number of days before the start, on delivery or after it. |
| Unit of measure (`units`)                       | `commercial.configure` for every entity | Each, day, hour, show, set and so on.                                                                                      |

Anyone with `commercial.view`, `finance.view` or `organisation.view` can read them. Screen: **Administration → Master data** (`/admin/master-data`).

## Defaults

`pnpm db:seed` and `pnpm user:create` add these if they're missing. They are not demo data, and they never replace a default an administrator picked.

- **Tax rates:** India GST 18% (default), GST 5%, zero-rated and exempt; UAE VAT 5% (default) and zero-rated.
- **Payment terms:** 50% advance with the balance on delivery (default), 100% in advance, and full payment 30 days after delivery.
- **Units:** EA, DAY, HR, SHOW, SET, LOT, WEEK, MONTH, KM, SQM.

These are labelled defaults recorded in the [decision register](decisions.md).

## Percentages

Percentages are integers in basis points everywhere (`src/lib/percent.ts`). People type "18" or "12.5"; `parsePercentToBps` accepts up to two decimal places and `formatBps` prints them back. No percentage goes through floating point.

## Indian GST split

A rate is stored as the total GST (18%). Splitting it into CGST and SGST for supplies within a state, or IGST between states, is an invoicing concern and comes with tax configuration in Stage 4.

## Number formats for new entities

Creating a legal entity now also gives it the default number format for every document type, with an April fiscal year for Indian entities and January elsewhere. Entities created earlier get an **Add default formats** button on the Numbering screen. See [numbering.md](numbering.md).
