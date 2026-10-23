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

## Closing

Moving a project from Financial close to **Closed** needs `projects.approve` (the Director), as before. If any closeout item is still open:

- the move is refused unless a reason is given, and the refusal lists the open items;
- with a reason, the project closes and the status change is recorded as an **override** (`project_status_changes.override`). The audit event records the open items.

Code: `src/server/projects/closeout.ts`, with the pure rules in `closeout-rules.ts`. The gate is in `changeProjectStatus`.
