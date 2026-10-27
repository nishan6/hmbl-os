# Project budgets

Each project has one budget, in its own currency, before tax (spec §10, "Budget management"). Domain code is in `src/server/projects/budget.ts`; the formulas are in `src/lib/budget.ts`, with unit tests.

## Categories and cost codes

Budget categories are the quote line categories (Crew, Equipment, Rental, Services, Production, Travel, Logistics, Fees, Other), so an accepted quote's lines land in the right category with no mapping. **Cost codes** break a category down further. They are group-wide master data (Administration → Master data, `projects.configure` for every entity). A line can only use an active cost code of its own category. Filing a line under a cost code changes no amount, so it is allowed at any time.

## The original budget

- **From a quote:** the accepted version's lines become the budget lines. Cost and revenue are taken after discount and before tax. The budget is fixed when the project is created.
- **Direct projects:** the project manager builds the lines on the Budget tab while the project is a draft. When the Director approves the project, the lines become the original budget, and the project's contract value and budget cost become their totals.

From then on the original amounts never change. A database trigger refuses any update or delete of a fixed line's cost, revenue or category. A new line can still be added with a zero original amount; change orders carry the amounts separately. `projects.baselineLockedAt` records when the budget was fixed.

## Committed and actual costs

`project_cost_entries` holds two kinds of entry against a budget line:

- **Committed:** something ordered or booked that hasn't been billed yet.
- **Actual:** a bill, an expense or a settlement. An actual cost can name the commitment it draws down.

Project managers can also enter these by hand (`projects.edit`). Some entries come from other records instead: approved bills and expense claims post actual costs, and confirmed freelance crew bookings post commitments (see [crew.md](crew.md)). A commitment that came from a record is closed or voided only through that record, such as cancelling the booking, never by hand.

Entries are append-only, and a database trigger enforces this. Only two changes are allowed, each once: **closing** a commitment, which releases whatever won't be billed, and **voiding** an entry with a reason. Nothing is deleted. A commitment can't be voided while live actual costs draw against it. Every entry, closure and void is audited.

## Formulas

All amounts are integer minor units.

| Figure                 | Formula                                                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Original budget        | Sum of the fixed line costs                                                                                                                           |
| Approved changes       | Sum of approved change-order cost amounts                                                                                                             |
| Revised budget         | Original + approved changes                                                                                                                           |
| Actual                 | Sum of actual entries that aren't void                                                                                                                |
| Committed              | For each open commitment that isn't void or closed: its amount less the live actual costs drawn against it, never below zero. These are then added up |
| Forecast at completion | The project manager's estimate if one is set (it needs a note), otherwise the larger of the revised budget and actual + committed                     |
| Remaining              | Revised − actual − committed. Negative means the line is overcommitted                                                                                |
| Variance               | Revised − forecast. Negative is an overrun, shown with a warning icon and the words "over budget"                                                     |
| Expected revenue       | Contract value, including any contingency, + approved revenue changes                                                                                 |
| Estimated gross profit | Expected revenue − forecast cost                                                                                                                      |
| Estimated gross margin | Gross profit ÷ expected revenue, in basis points, truncated                                                                                           |
| Invoiced, collected    | Issued tax invoices before tax less credit notes; and what receipts have cleared on them, tax included                                                |

Because an actual cost drawn against a commitment lowers that commitment by the same amount, moving a cost from committed to actual never counts it twice.

## Who sees it

The Budget tab, and every cost figure, is for people who can see project costs (see [projects.md](projects.md)). Everyone else sees revenue only, on the Overview tab.

## Integrity

`checkBudgetIntegrity` (`src/server/projects/integrity.ts`) cross-checks a project's budget records once its baseline is fixed. It confirms that:

- the budget lines add up to the project's original budget cost;
- each approved change order's totals equal the sum of its lines, and every line is on the budget;
- no line has a negative revised cost or revenue;
- there is one budget version per approved change order plus version 1, numbered in order;
- version 1 equals the original budget, and the latest version equals the revised cost and expected revenue;
- every actual cost draws down only a commitment on its own line.

`checkOperationsIntegrity`, in the same file, cross-checks the operational records against the project's costs (spec §32 D, operational integrity). It confirms that:

- a crew booking's or purchase order line's commitment is on this project, on the same budget line, belongs to that booking or line, and is closed or voided once the booking or order has ended;
- crew work is recorded only on days the person was booked;
- a bill line drawn from a purchase order has the order's vendor, currency and budget line, and no order line is billed beyond what can be (received for goods and rentals, ordered for services);
- every approved bill line on the budget has exactly one live actual cost, drawing down the same commitment as the bill line, and a bill that isn't approved has none;
- a closed or cancelled equipment booking has nothing still out.

The Budget tab runs both checks every time it loads, and shows any disagreement in a red alert. It never changes data. `tests/integration/budget-integrity.test.ts` takes a quote project and a direct project through costs, voids, approved and withdrawn change orders, forecasts and resource plans, checks after each step, and checks the same figures from the budget, the versions and the original lines. `tests/integration/operations-closeout.test.ts` covers the operations check and the closeout items checked from the records.
