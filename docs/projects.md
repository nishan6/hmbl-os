# Projects

A project is a job HMBL is delivering (spec §10). Most projects come from an accepted quote; internal work and retainers can be created directly. Domain code is in `src/server/projects/`.

## Lifecycle

The spec's suggested default, in `src/server/projects/lifecycle.ts` (pure rules, unit-tested):

```
Draft → Commercial review → Approved → Planning → Ready for execution → In progress
      → Completed → Financial close → Closed
```

plus **On hold** and **Cancelled** from any status up to Completed.

| Move                                                       | Who                                  | Reason needed |
| ---------------------------------------------------------- | ------------------------------------ | ------------- |
| Draft → Commercial review                                  | `projects.submit` (project manager)  | No            |
| Draft or Commercial review → Approved                      | `projects.approve` (Director)        | No            |
| Commercial review → Draft (sent back)                      | `projects.reject`                    | Yes           |
| Forward from Approved up to Completed, skipping is allowed | `projects.edit`                      | No            |
| Completed → Financial close                                | `projects.edit`                      | No            |
| Financial close → Closed                                   | `projects.approve`                   | No            |
| Back one or more steps after approval                      | `projects.edit`                      | Yes           |
| Closed → Financial close (reopen)                          | `projects.approve`                   | Yes           |
| On hold, and resume                                        | `projects.edit`                      | To hold       |
| Cancel a draft / an approved project                       | `projects.edit` / `projects.approve` | Yes           |
| Reopen a cancelled project                                 | `projects.approve`                   | Yes           |

An approved project never goes back to draft: changes to an approved budget go through change control. A project on hold or cancelled remembers where it was (`resumeStatus`) and returns there. Every move is kept in `project_status_changes` (who, when, from, to, reason) and audited as `project.status_changed`. Closed and cancelled projects can't be edited.

## Project details

Name, project type, revenue model, business line, project manager, producer, client PO, start and end dates, venue, other locations (for tours), description, scope and deliverables. Editing needs `projects.edit` for the project's entity and is audited field by field (`project.updated`).

**Project types** are group-wide master data (Administration → Master data), each with a usual revenue model: Live event, Broadcast production, Equipment rental, Touring, Retainer and Internal project by default. `projects.configure` for every entity adds or archives them.

## Created directly

`/projects/new` (`projects.create`) starts a **Draft** project without a quote, for internal work, retainers or jobs agreed outside the quote workflow. It has a number from the entity's `project` scheme, a currency, and a client unless the revenue model is Internal. It needs the Director's approval like any other draft.

## Budget

Original budget, committed and actual costs, forecasts and cost codes: see [budget.md](budget.md).

## Created from an accepted quote

`createProjectFromVersion` runs inside the acceptance transaction (see [commercial.md](commercial.md)) and keeps the accepted version's figures as the project's baseline. The client has accepted the price, so the project starts at **Approved**, with the quote's scope and deliverables:

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

- `/projects`: open projects you can see, searchable by number, name or client, filtered by status and the entity picker.
- `/projects/new`: create a project directly.
- `/projects/[id]`: details, scope, budget, billing milestones, figures, the lifecycle and the status history.
- `/projects/[id]/edit`: project details.
- `/projects/[id]/budget`: budget figures, lines, forecasts and cost entries (cost viewers only).
- Client and opportunity pages list their projects.
