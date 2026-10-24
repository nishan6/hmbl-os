# Project closeout

The **Closeout** tab is the checklist a project works through before it closes (spec §10). The list was agreed with Nishan on 2026-10-23:

1. All client invoices issued
2. Client payments collected
3. Vendor bills received
4. Crew settled
5. Equipment returned
6. Expenses reconciled
7. Final report filed

People with `projects.edit` mark each item done, or not applicable with a note, and can reopen it, once the project is approved. **Final report filed** needs a current, unarchived document in the _Closeout report_ category first. Each change is audited as `closeout.item_updated`.

Until Finance (Stage 4) tracks invoices, payments, bills and expenses, those items are confirmed by hand. Stage 4 can tick them automatically.

## Checked from the records

Three items are checked against what Stage 5 records, every time the tab loads. Each problem is listed under its item, linked to the record that fixes it:

| Item                  | Open while                                                                                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Crew settled          | a crew booking is still proposed; work recorded on a booking isn't approved; a freelancer's approved work isn't settled; a crew settlement's bill isn't approved              |
| Equipment returned    | equipment dispatched to the project isn't back (returned, damaged or lost); a rental on a purchase order is still on hire                                                     |
| Vendor bills received | a purchase order for the project isn't closed or cancelled; a vendor bill with a line on the project is a draft or awaiting approval (crew settlement bills count under crew) |

Employees' approved work isn't settled through a bill (it is payroll), so it doesn't hold the item open.

While an item has problems it can't be marked done or not applicable; the refusal names the first problem. An item ticked earlier is open again if the records later disagree (for example a new purchase order after vendor bills were ticked), and it shows a **Reopen** button so the stale tick can be cleared. Code: `src/server/projects/closeout-checks.ts`.

## Closing

Moving a project from Financial close to **Closed** needs `projects.approve` (the Director), as before. If any closeout item is still open, including one the records hold open despite a tick:

- the move is refused unless a reason is given, and the refusal lists the open items;
- with a reason, the project closes and the status change is recorded as an **override** (`project_status_changes.override`). The audit event records the open items.

Code: `src/server/projects/closeout.ts`, with the pure rules in `closeout-rules.ts`. The gate is in `changeProjectStatus`.
