# Numbering schemes

Records use UUIDs internally. Quotes, projects, invoices and other documents also get a human-readable number from a **numbering scheme**.

## Schemes

A scheme belongs to one legal entity and one document type (`src/server/numbering/document-types.ts`). Each entity has at most one active scheme per document type; the database enforces it.

| Setting                | Meaning                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `pattern`              | Literal text plus tokens, e.g. `INV/{FYY}/{SEQ:5}`                                    |
| `resetPolicy`          | `NEVER`, `YEARLY` (calendar), `FISCAL_YEARLY` or `MONTHLY`                            |
| `fiscalYearStartMonth` | 4 (April) for India, 1 for calendar-year entities                                     |
| `startAt`              | First number in each period. Use it to continue a series migrated from another system |

### Default formats

A new legal entity gets the default scheme for every document type (`DEFAULT_SCHEMES` in `document-types.ts`) in the same transaction, with `fiscalYearStartMonth` 4 for Indian entities and 1 elsewhere. For an entity created before that, the Numbering screen offers **Add default formats**, which adds only the types that have no active scheme (`addDefaultNumberingSchemes`, needs `organisation.configure` for that entity).

### Tokens

| Token             | Example            | Meaning                                                                                |
| ----------------- | ------------------ | -------------------------------------------------------------------------------------- |
| `{ENTITY}`        | `HMBL-IN`          | Legal entity code                                                                      |
| `{YYYY}` / `{YY}` | `2026` / `26`      | Calendar year                                                                          |
| `{MM}`            | `04`               | Month                                                                                  |
| `{FY}` / `{FYY}`  | `2026-27` / `2627` | Fiscal year                                                                            |
| `{FYS}`           | `26`               | Fiscal year's starting year: FY 2026-27 is `26`, also in February 2027                 |
| `{SEQ:n}`         | `00042`            | Sequence padded to n digits; required exactly once. Larger numbers are written in full |

Sales invoices can also use values from the invoice (`fields` in `document-types.ts`; other documents refuse them):

| Token       | Example | Meaning                                                                                |
| ----------- | ------- | -------------------------------------------------------------------------------------- |
| `{CLIENT}`  | `MAG`   | The client's invoice code, or `INT` for one-off clients                                |
| `{SERVICE}` | `VLR`   | The service chosen on the invoice                                                      |
| `{CSEQ:n}`  | `03`    | A second count kept for each `{CLIENT}` value in the same period. Needs `{CLIENT}` too |

Outside tokens, patterns allow capital letters, digits, `-`, `/` and `_`. A rendered number is at most 40 characters. A scheme that resets every period must show that period in the number (a yearly reset needs a year token), so numbers can't repeat.

Dates are read in the **legal entity's time zone**. A document dated 00:30 on 1 April in Mumbai belongs to the new Indian fiscal year even though it is still 31 March in UTC.

### Changing a format

A scheme's pattern and reset policy never change after creation, because changing them could repeat numbers already issued. To change the format, archive the scheme and create a new one, using `startAt` if the sequence should carry on.

### Carrying on a series

Each scheme has a page under Admin → Numbering that shows its counts: the last number issued in each period and, with `{CSEQ}`, for each client code. **Set count** records the last number already issued elsewhere, overall or for one client code, so the next number follows it (`setNumberCounter`, `organisation.configure`, audited). A count only moves forward: the service refuses a lower value, and a database trigger refuses lowering or deleting a counter row, because going back would issue a number twice.

**Replace format** archives a scheme and creates its successor in one transaction, so the entity is never without one. The new scheme's counts start empty.

### The GST length limit

GST invoice numbers may be at most 16 characters (CGST Rules, rule 46(b)). The scheme page warns when an Indian sales invoice or credit note format's example is longer, but does not block it: HMBL's current format reaches 17 characters with a four-letter client code or a three-digit count, and Nishan plans to drop the dashes later (see [decisions](decisions.md)).

## Issuing numbers

```ts
await db.$transaction(async (tx) => {
  const { number } = await allocateNumber(tx, { documentType: "quotation", legalEntityId, date });
  await tx.quotation.create({ data: { number, ... } });
});
```

`allocateNumber` increments a counter row (`number_counters`, one per scheme per period, plus one per client code and period for `{CSEQ}`, keyed `FY2026|MAG`) with a single `INSERT … ON CONFLICT DO UPDATE`. The overall row is always taken before the client's, so two issuers can't deadlock. Formats with `{CLIENT}` or `{SERVICE}` need the caller to pass them in `fields`. The row stays locked until the caller's transaction ends, so:

- concurrent requests queue and never get the same number (tested with 20 at once);
- if the document fails to save and the transaction rolls back, the number is returned and the series has **no gaps**.

Modules that issue numbers should also put a unique constraint on their own `(legalEntityId, number)` column as a second guard.

## Defaults

`DEFAULT_SCHEMES` lists labelled starting formats (`Q-2627-0001`, `INV/2627/00001`, `PO/2627/00001`, …), applied by the dev seed to the demo entities. They are not approved policy. Indian GST invoice numbers must be at most 16 characters of letters, digits, `-` and `/`, unique per financial year; the defaults fit, and a unit test checks it. Finance should confirm the final formats (see [decisions](decisions.md)).

Managing schemes needs `organisation.configure` for the entity, and every create or archive is audited.
