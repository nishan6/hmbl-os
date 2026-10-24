# Crew and freelancers

The people HMBL puts on projects: staff and freelancers (spec §12, "Crew records"). The service is `src/server/crew/members.ts`; rules that need no database (which rate applies, overtime, overlapping dates, certificate expiry) are in `src/lib/crew.ts`, with unit tests. Screens are under **Crew** in the sidebar.

## Crew records

A crew member is shared by every legal entity, like a client or a vendor, because the same people work for every company in the group. Each record holds:

- **Who they are:** name, staff or freelancer, email, phone, the city they are based in, and the other places they will work.
- **Roles and skills**, such as "Lighting operator", "Rigging" or "grandMA3". The crew list filters by skill.
- **A contract reference**, for the agreement or NDA filed under Documents.
- **Certifications**, with the issuer, number and expiry. A certificate that has expired is shown as overdue, and one that expires within 30 days as due.
- **Time off**: days they can't work, with a reason. Bookings on these days show as conflicts.

Staff can be linked to the HMBL OS user they sign in as, one record per user. A freelancer is linked instead to the **vendor** they are paid through, which holds their bank details, PAN and usual TDS (see [payables.md](payables.md)). A database CHECK keeps staff without a vendor and freelancers without a user.

Only the personal data a crew booking needs is collected. There is no date of birth, ID number or home address.

## Sensitive fields

Anyone with `crew.view` sees names, skills, contact details, certifications and time off. Three things need `crew.view_sensitive` (Owner, Finance and the Crew coordinator role):

- **Rates**;
- the **emergency contact**;
- the **vendor** a freelancer is paid through.

Someone without it never receives these values from the server. When they edit a record, the hidden fields keep their values. They can't switch a freelancer with a paying vendor to staff, because that would drop the vendor.

## Rates

A rate is a day, half-day or overtime-hour amount, before tax, in a currency, from a date. It can be for one role, such as "Rigger", or for any role. When a booking needs a rate:

1. A rate for that role beats a rate for any role.
2. Among equals, the one that started last wins.
3. Only rates in force on the day, in the project's currency, count.

Rates are never edited or deleted. Adding a rate ends the open rate of the same role, type and currency the day before the new one starts. A new rate can't start on or before the open one it replaces. A rate can also be ended on a chosen day. Every rate added or ended is audited.

**Overtime** without an overtime rate costs the day rate ÷ 10 hours × 1.5, rounded half away from zero. This is a labelled default (see [decisions.md](decisions.md)).

## Bookings

A booking puts one person on a project for a role and a run of days, usually against one of the project's crew requirements (see [resources.md](resources.md)). It starts **proposed** and is then **confirmed**, **declined** or **cancelled**. Anyone who can edit the project or edit crew can book (`projects.edit` or `crew.edit` in the project's entity).

A freelancer's booking takes its day, half-day and overtime rates from their rate card for the role, in the project's currency, on the first day. The rates can be changed on the booking. Staff bookings carry no rates.

**Conflicts.** When a booking is proposed or confirmed, the person's other bookings and time off over the same days are checked:

- a confirmed booking or time off is a **hard clash**. Confirming over it needs `crew.approve` (Owner, Director and Crew coordinator) and a reason, which is kept on the booking and audited;
- another proposed booking is a **soft clash**, shown as a warning.

Confirmations lock the person's record, so two people can't confirm clashing bookings at the same moment.

**Cost.** Confirming a freelancer's booking on a budget line commits its cost to the project budget: every booked day at the day rate. This needs the project's budget to be approved. Changing the dates or rate replaces the commitment. Declining or cancelling ends it: it is voided if nothing was billed against it, and closed otherwise. Staff bookings commit no cost, because staff are paid through payroll.

**Replacing someone.** Replacing the person on a live booking cancels it with the reason and proposes the replacement for the same role and requirement, from the day after the last day worked. Days already worked stay with the person who worked them.

**Call sheet.** For any day, the project's call sheet lists the confirmed crew, their role, call time, who they report to and their phone number.

## Work

On a confirmed booking, each day worked is recorded as a full or half day, with any overtime (typed as hours, such as 2.5 or 2:30) and out-of-pocket expenses. A day can be changed until it is approved. The project manager, or someone with `crew.approve` or `projects.approve`, approves the booking's days. Nobody approves their own work.

What approved work costs:

- a full day at the day rate;
- a half day at the half-day rate, or half the day rate when there is none;
- overtime at the overtime rate per hour, or the default above, for the minutes worked, rounded once;
- expenses as entered.

## Settlements

Finance settles a freelancer's approved work from **Finance › Crew settlements** (`finance.create`). One settlement covers all of the person's approved, unsettled work in one entity and drafts a **vendor bill** to the vendor they are paid through:

- one line per booking for full days, half days, overtime and expenses, on the booking's project and budget line, charged to account 5000 (freelance crew);
- the full-day line (or half-day line when there are no full days) draws down the booking's commitment, so approving the bill moves the cost from committed to actual without counting it twice;
- default GST only when the vendor has a GSTIN, the vendor's TDS, and the vendor's payment terms (45 days at most for MSME vendors);
- the reference `CS-` and eight characters stands in for an invoice the freelancer may not send.

The bill then goes through the usual steps: Finance checks and submits it, the project manager approves it, Finance pays it (see [payables.md](payables.md)). Discarding or voiding the bill releases the work so it can be settled again. People without a vendor, bookings without a day rate and work in a currency other than the entity's base currency are listed with what is stopping them, and are settled by hand.

## Permissions

| Action                                 | Needs                                                 |
| -------------------------------------- | ----------------------------------------------------- |
| See crew                               | `crew.view`                                           |
| Add a crew member                      | `crew.create`                                         |
| Edit details, certifications, time off | `crew.edit`                                           |
| See or change rates and pay links      | `crew.edit` and `crew.view_sensitive`                 |
| Archive or restore                     | `crew.archive`                                        |
| Book, confirm, change or end bookings  | `projects.edit` or `crew.edit`                        |
| Confirm over a hard clash              | `crew.approve`, with a reason                         |
| Record work                            | `projects.edit` or `crew.edit`                        |
| Approve work                           | Project manager, `crew.approve` or `projects.approve` |
| Settle work                            | `finance.create`                                      |

Project managers can add and edit crew but don't see rates or emergency contacts. The **Crew coordinator** default role holds every crew permission.

Every change is audited against the crew member: `crew_member.created`, `.updated`, `.archived`, `.restored`, `crew_rate.added`, `.ended`, `crew_certification.added`, `.removed`, `crew_unavailability.added`, `.removed`. Bookings and work are audited against the project: `crew_assignment.proposed`, `.confirmed`, `.updated`, `.declined`, `.cancelled`, `crew_work.recorded`, `.updated`, `.removed`, `.approved`. Settlements are audited as `vendor_bill.drafted` and `crew_settlement.created`.
