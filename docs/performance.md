# Performance

The spec asks to measure the important paths and fix bottlenecks with evidence, not to optimise blindly (§26). This is what was measured, what it found, and how to measure again.

## How it is measured

`pnpm test:perf` (`tests/perf/volume.test.ts`) fills the test database through the real services, so every invoice, bill, receipt and payment has its journal, numbering and audit events, then times the reads people wait on most. Each read runs once to warm up and then five times; the median is reported. A median over 1.5 seconds fails the run. CI runs it on every pull request.

- `PERF_SCALE=4 pnpm test:perf` multiplies the volume.
- `PERF_OUT=perf.json` writes the results as JSON.

The default volume is about three years of HMBL's work at its current size, with room to spare: 3,000 clients, 1,500 projects, 1,200 issued invoices (two in three paid), 600 approved bills (half paid), 2,900 posted journals and 10,000 audit events. `PERF_SCALE=4` is four times that.

The timings are of the server functions behind each page, on the database, without the browser. Pages add rendering time on top, which grows with the rows shown, not with the size of the database: lists show at most 300 or 500 rows, and the audit log pages 50 at a time.

## Results

Measured on 2026-10-26 in the development container (Postgres 16 on the same machine), medians in milliseconds, after the fix below unless the column says otherwise.

| Read                                | Default volume | ×4 before the fix | ×4 now |
| ----------------------------------- | -------------: | ----------------: | -----: |
| Clients list (500 rows)             |             12 |                10 |     10 |
| Clients search                      |              5 |                17 |     16 |
| Projects list (500 rows)            |             16 |                29 |     22 |
| Projects search                     |             19 |                39 |     37 |
| Invoices list (300 rows)            |             15 |                25 |     24 |
| Bills list (300 rows)               |             11 |                16 |     15 |
| Receivables ageing                  |             19 |               463 |     57 |
| Payables ageing                     |             12 |               125 |     38 |
| Trial balance                       |              7 |                20 |     24 |
| Profit and loss, one year           |              9 |                25 |     17 |
| Day book, one month                 |             62 |               221 |    244 |
| Executive dashboard                 |             41 |               460 |    108 |
| Audit log, first page               |              1 |                 1 |      1 |
| Readiness checks, finance and audit |            119 |               592 |    346 |

## What it found and what changed

- **Receivables and payables ageing were quadratic.** For each open invoice or bill they searched the whole list of receipt or payment allocations. At four times the volume the receivables ageing took 463 ms, against 39 ms at the default volume. It now takes 19 ms and 57 ms. They now group the allocations once and look them up by id (`src/server/finance/receivables.ts`, `payables.ts`). The executive dashboard and the readiness checks use both, so they improved with them. The integration tests for ageing and the control-account check pass unchanged.
- **The day book grows with the journals in the range.** It is linear, and the month measured is a worst case: the test dates every receipt and payment on 30 September, so that month holds about two in five of all journals. Left as it is.
- **The readiness checks read every journal.** That is their job, and they run on demand or once a day, not on every page. Left as it is.
- Lists stay flat as the data grows, because they are capped. Searches (`contains`, any case) read every row of the table, which takes milliseconds at these sizes; if they slow down at a much larger volume, trigram indexes are the next step.

## When to measure again

Run `pnpm test:perf` before changing a list, a report or the dashboard, and `PERF_SCALE=4 pnpm test:perf` before a large import. If HMBL grows past about four times today's volume, run it at the new scale and look again at the day book and the readiness checks first.
