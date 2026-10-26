# Project schedule

The **Schedule** tab holds the project's plan in dates (spec §10, "Schedule and milestones"). Domain code is in `src/server/projects/schedule.ts` and `billing-dates.ts`. The pure rules are in `src/lib/schedule.ts` and `src/server/projects/milestones.ts`, with unit tests.

## Schedule items

| Kind      | What it is                                          | Dates                  |
| --------- | --------------------------------------------------- | ---------------------- |
| Show date | A show or event day, with its venue or city         | One day or a range     |
| Phase     | Build, load-in, rehearsal, travel, de-rig and so on | One day or a range     |
| Milestone | A delivery checkpoint that is ticked off when done  | One day (the due date) |

A project from a quote starts with one show date, taken from the quote's event dates and venue. The migration did the same for existing projects. A show date outside the project's event dates is flagged. A tour can have one show date per city.

Status is worked out against today in the legal entity's timezone:

- **Milestones** are Completed, Overdue, Due (within 7 days) or coming up.
- **Shows and phases** are In progress, Past or coming up.

People with `projects.edit` can add, change, remove and tick off items while the project is open. Each of these is audited (`schedule.item_created`, `.item_updated`, `.item_deleted`, `.milestone_done`, `.milestone_reopened`). Database CHECKs keep the dates in order, keep milestones to one day, and allow only milestones to be completed.

## Billing milestone due dates

Billing milestones come from the quote's payment terms (see [projects.md](projects.md)). Their due dates follow the trigger's date:

- **On acceptance:** the acceptance date, which never moves.
- **Before the start:** the event start, less the days.
- **On delivery:** the event end, or else the event start.
- **After delivery:** the delivery date, plus the days.

When the event dates on the project change, the due dates that follow them move too, and `project.billing_due_dates_moved` records the old and new dates. A project manager can instead set a due date by hand, with a reason. That date then stays put when the event dates move. A database CHECK makes sure a date set by hand always has a reason. Clearing the date goes back to the calculated one. Each change is audited as `project.billing_due_date_set`.

Finance invoices against these milestones ([invoicing.md](invoicing.md)).
