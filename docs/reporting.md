# Management dashboards

Dashboards for each responsibility (spec §21), under **Reports** in the navigation. They read the records already in HMBL OS: nothing is typed in, estimated or made up. The services are in `src/server/reports/`; every figure's definition and source is in `src/lib/metrics.ts`, shown under the figure ("How it's counted") and listed on Reports → **Definitions**.

| Dashboard       | Page                  | Who                                                  | Covers                                                                                                                                                                                                                                                            |
| --------------- | --------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Executive       | `/reports/executive`  | `reports.view`; money needs `reports.view_sensitive` | One legal entity: pipeline, quotes awaiting approval, active projects, contracted and invoiced revenue, collections, receivables, payables, cash and bank, project gross profit, business lines, budget exceptions, shows in the next 30 days, resource conflicts |
| Project manager | `/reports/projects`   | `reports.view` and `projects.view`                   | Each running project (Approved to Financial close): schedule, budget against actual, missing approvals, crew, equipment, travel, client inputs, invoice milestones, closeout                                                                                      |
| Production      | `/reports/production` | `reports.view` and `production.view`                 | Shows today and in the next 30 days: current status, crew, equipment and logistics readiness, open incidents, key contacts, recent updates and notes                                                                                                              |
| Finance         | `/finance`            | `finance.view`                                       | Built in Stage 4 ([financial-reports.md](financial-reports.md))                                                                                                                                                                                                   |

## Access

- Each section also needs view access to the module it reads. Without it the section is left out, and the page says why when it is money. For example, Finance has no CRM access by default, so its executive dashboard has no pipeline.
- Project budgets on the project manager dashboard follow the project rule: only people who may see project costs (`projects.edit`, `projects.view_sensitive`, or commercial editing) see them.
- The production dashboard never shows costs, rates, emergency contacts, identity documents, booking references, or who was involved in an incident, the same as the show day.
- Entity reach applies everywhere: a user with access to one entity sees only that entity's projects and shows.

## Money

Each figure is for one legal entity. Finance figures are in the entity's base currency, from issued documents and posted journals. Pipeline, quotes and contracted revenue keep each record's own currency and are listed per currency, never added across currencies. There is no group total: the spec does not let the group be treated as one accounting entity, and no group exchange-rate policy exists yet ([decisions.md](decisions.md), "Dashboard money").

Invoiced revenue can differ from revenue in the profit and loss when an entity recognises revenue on completion: invoices then sit in client advances until the project completes.

## Demo data

A demo entity's executive dashboard carries a "Demo data" warning, and demo projects and shows carry a Demo tag on every dashboard. Demo records exist only in development and test databases (created by `prisma/seed.ts`).

## Dates

"Today" is the entity's local date. The financial year comes from the entity's finance settings. Dashboards look 30 days ahead for shows and billing milestones (`LOOKAHEAD_DAYS`).

## Not covered yet

- Consolidated group figures and intercompany views.
- Charts and trends over time; every figure is today's.
- Saved filters or scheduled emailed reports.
