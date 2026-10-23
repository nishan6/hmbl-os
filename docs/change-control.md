# Change control

Once a project is approved, its original budget is fixed (see [budget.md](budget.md)). Every later change to cost or revenue goes through a **change order** (spec §10, "Change control"). Domain code is in `src/server/projects/change-orders.ts`; budget versions are in `src/server/projects/versions.ts`.

## Workflow

```
DRAFT ──submit──▶ SUBMITTED ──approve──▶ APPROVED (new budget version)
  ▲                   │ send back (reason required)
  └───────────────────┘
DRAFT / SUBMITTED ──withdraw (reason required)──▶ WITHDRAWN
```

| Step                          | Who             | Permission         |
| ----------------------------- | --------------- | ------------------ |
| Raise, edit, add lines        | Project manager | `projects.edit`    |
| Record the client's agreement | Project manager | `projects.edit`    |
| Submit                        | Project manager | `projects.submit`  |
| Approve                       | Director        | `projects.approve` |
| Send back                     | Director        | `projects.reject`  |
| Withdraw                      | Project manager | `projects.edit`    |

Change orders can only be raised on an approved project whose budget is fixed, and stop when the project is closed or cancelled. They are numbered per project: CO-01, CO-02 and so on. When the approver also submitted the change, it is marked **Own change** and the audit event records `selfApproval`.

## What a change order holds

- The title and the reason, which are required, plus a description, the scope impact, the schedule impact and a schedule change in days.
- **Lines.** Each line moves an existing budget line up or down by a signed cost and revenue amount, or adds a new line. A new line can only add cost or revenue. A line with both amounts at zero is refused.
- **The client's agreement.** This records the date, the person, the method and a reference. It is required before approval whenever the change alters revenue, and a database CHECK enforces this.

The lines can only change while the change order is a draft, and a database trigger enforces this too. The change order's total cost and revenue are kept as the sum of its lines.

## Approval

Approving a change order, in one transaction:

1. Refuses the approval if any existing line would end up with a negative revised cost or revenue.
2. Creates each new line as a budget line with a zero original amount, in a section named "Change CO-xx", so that spend can be recorded against it.
3. Adds a **budget version**: the revised budget cost and the expected revenue as they now stand.
4. Records the audit event `change_order.approved`, with the budget version and the amounts.

The original budget lines are never updated. The budget's **Changes** column is the sum of the approved change-order lines for each budget line (`approvedChangesByLine`), and the revised budget is the original plus the changes.

## Budget versions

Version 1 is the original budget. It is recorded when the baseline is fixed, either on quote conversion or when a direct project is approved. Each approved change order adds the next version. The versions are listed on the Change orders tab. People who can't see project costs see revenue only.

## Billing milestones

Change orders don't change billing milestones. Extra revenue from a change is invoiced by Finance (Stage 4), using the change order as its source.

## Audit events

`change_order.created`, `.updated`, `.line_saved`, `.line_removed`, `.client_approval_recorded`, `.submitted`, `.approved`, `.rejected`, `.withdrawn`. All of them are recorded against the project, with the change order in the metadata.
