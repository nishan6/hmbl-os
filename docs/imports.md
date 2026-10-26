# Record imports

Staged CSV imports of existing records (spec §23), under Administration → **Imports** (`/admin/imports`). The service is `src/server/imports/batches.ts`; what each kind reads and how its rows are checked, matched and written is in `src/lib/imports.ts` and `src/server/imports/kinds.ts`.

Financial history (opening balances, open invoices and bills) is a separate migration, not a record import.

## What can be imported

| Kind      | Required fields                         | Who                                           | Matched as a possible duplicate on                                     |
| --------- | --------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| Clients   | Name, country, currency                 | `crm.create`; updating needs `crm.edit`       | The CRM's own duplicate check: tax ID, normalised name, website domain |
| Vendors   | Name, country, currency                 | `finance.create` or `procurement.create`      | GSTIN, PAN or normalised name                                          |
| Crew      | Name, staff or freelancer               | `crew.create`; updating needs `crew.edit`     | Email, phone or normalised name                                        |
| Equipment | SKU, name, category, tracking, currency | `equipment.create`; updating `equipment.edit` | SKU                                                                    |

Not imported, by design: vendor bank details (only Finance changes how a vendor is paid, on the vendor's own screen), crew emergency contacts and identity documents, and equipment assets (serial numbers are added on the item). Vendor TDS fields need `finance.create`; a row with them from anyone else is refused rather than silently dropped. Equipment categories must already exist.

## The steps

1. **Read.** Choose what the file holds and a CSV file (the first row is the column names; at most 5,000 rows and 2 MB). The browser reads the file and sends its text. The file is kept as rows on a staged batch with its SHA-256; nothing else is written. If the same file was committed before, the batch says so.
2. **Map.** Columns are matched to fields by name and common aliases. Each field can instead take one value for every row, e.g. a country. Until every required field has a source, every row is marked with the reason.
3. **Check.** Every row is checked with the module's own rules (the same as the form), against the rest of the file (the same record twice is a problem on the later line), and against existing records. Each row is **Ready**, **Has problems** (with the reasons per field) or **Possible duplicate** (with the record it looks like and why).
4. **Correct.** A row with problems can be corrected on the page; the correction is kept with the row and audited, and the file itself is untouched. The problem rows can also be downloaded as CSV (the file's columns plus line and problem), fixed and imported again.
5. **Decide.** A possible duplicate is never merged, updated or created automatically. A person chooses for each: update the existing record (the file's non-blank values replace the record's; blank cells change nothing), create a new record anyway, or skip the row. Creating is not offered when the match is on something that must be unique (a client's tax ID, an equipment SKU). "Skip them all" and "Create new records for them" apply to the undecided rows at once, and still leave unique matches for a person.
6. **Dry run.** Checks everything again against today's records and says how many would be created, updated, skipped and not imported, and what still blocks the commit. It writes nothing but the check results.
7. **Commit.** Runs the dry run again, then writes row by row through each module's service, so every record gets the same permissions, numbering and audit event as one typed in. A row the service refuses is marked **Failed** with the reason and the rest carry on. Rows with problems are recorded as **Not imported**; nothing is dropped without a trace. Afterwards each row links to the record it created or updated, and the batch keeps the totals.

A batch can be discarded before it is committed. A committed batch can't change.

## Integrity and safety

- One commit at a time: the batch is claimed before writing. If a commit stops part-way (a closed tab, a lost connection), it can be committed again after 15 minutes; rows already written are not written twice.
- Every step is audited against the batch (`import.staged`, `import.mapped`, `import.row_corrected`, `import.row_decided`, `import.committed`, `import.discarded`), besides the audit event each record's own service records.
- Only people who may create a kind see its batches.
- Imported records are real records (`isDemo` is false); demo records still come only from `prisma/seed.ts`.

## Reconciling

The committed batch's totals (created, updated, skipped, not imported, failed) add up to the rows in the file. Compare them with the source system's count before switching it off, and download the problem rows to deal with the rest.
