# Projects

A project is a job HMBL is delivering (spec §10). In this stage a project only exists as the result of an accepted quote; planning, crew, equipment and actuals come in the next stage. Domain code is in `src/server/projects/`.

## Created from an accepted quote

`createProjectFromVersion` runs inside the acceptance transaction (see [commercial.md](commercial.md)) and keeps the accepted version's figures as the project's baseline:

| Project              | From the quote version                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| Number               | The entity's `project` number scheme (`P-2627-0001`)                                                       |
| Name, client, entity | The quote's title, client and legal entity; its opportunity when it has one                                |
| Contract value       | Subtotal plus contingency, before tax; tax and total kept alongside                                        |
| Budget cost          | The version's total cost                                                                                   |
| Budget lines         | One per quote line: section, category, quantity, days, unit, cost and revenue (after discount, before tax) |
| Billing milestones   | One per payment-schedule instalment, splitting the total with tax                                          |
| Client PO, event     | The PO number from the acceptance; event dates and venue                                                   |

`sourceQuoteVersionId` is unique, so a version can't become two projects.

Milestone amounts use `splitByPercent`, so they always add up to the total. Due dates are set when the date the trigger depends on is known: on acceptance → the acceptance date; days before the start → event start minus the days; on delivery → event end (or start); days after delivery → that plus the days. A quote without a payment schedule gets one milestone, the full amount on delivery. Pure logic is in `milestones.ts` with unit tests.

## Who sees what

Projects are entity-scoped (`projects.view` with `{ legalEntityId }`). Budget cost and planned margin are shown to `projects.edit`, `projects.view_sensitive`, or anyone who sees quote costs (`commercial.edit`, `commercial.view_sensitive`); others see revenue only.

## Screens

- `/projects`: every project you can see, searchable by number, name or client, filtered by the entity picker.
- `/projects/[id]`: details and acceptance, budget, billing milestones and figures.
- Client and opportunity pages list their projects.
