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

Until Finance (Stage 4) brings purchase orders, vendor bills and expenses, project managers enter these by hand (`projects.edit`). Stage 4 will create the same entries automatically.

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
| Invoiced, collected    | Shown as "With Finance" until Stage 4                                                                                                                 |

Because an actual cost drawn against a commitment lowers that commitment by the same amount, moving a cost from committed to actual never counts it twice.

## Who sees it

The Budget tab, and every cost figure, is for people who can see project costs (see [projects.md](projects.md)). Everyone else sees revenue only, on the Overview tab.
