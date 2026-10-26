# Crew and equipment planning

The **Crew and equipment** tab records what a project needs (spec §10, "Staffing plan" and "Equipment plan"). Domain code is in `src/server/projects/resources.ts`. The money rules are in `src/lib/resources.ts`, with unit tests.

## Requirements

A requirement is one of two things:

- A **crew role**, such as "Lighting operator × 2".
- An **equipment item**, such as "Moving head lights × 24".

Each one has a date range, which counts both the first and last day, and optionally:

- **A budget line that pays for it.** Crew is paid from Crew lines. Equipment is paid from Equipment or Rental lines.
- **A day rate:** the planned cost per unit per day, before tax.
- **Notes.**

This is a plan of needs. Named crew members and specific assets are booked against these requirements, with clash checks, in [crew.md](crew.md) and [equipment.md](equipment.md).

People with `projects.edit` add, change and remove requirements while the project is open. Each change is audited as `resource.created`, `.updated` or `.deleted`. A database CHECK keeps the quantity above zero, the dates in order and the rate non-negative. Removing a draft budget line unlinks its requirements.

## Plan against budget

The planned cost is quantity × days × day rate. For each budget line, the priced plan is compared with the line's **revised budget**, meaning the original budget plus approved change orders (see [budget.md](budget.md)):

- **Within budget:** the plan is at or below the revised budget.
- **Over by …:** the plan exceeds it. The usual fix is to adjust the plan or raise a change order.

Requirements without a line or a day rate are left out of the check, and the page counts them. The plan never changes the budget itself: committed and actual costs still come from cost entries.

Day rates, planned costs and the check are shown only to people who can see project costs (`canSeeProjectCosts`). Someone who can edit but can't see costs keeps the existing rate when they save.
