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

## Permissions

| Action                                 | Needs                                 |
| -------------------------------------- | ------------------------------------- |
| See crew                               | `crew.view`                           |
| Add a crew member                      | `crew.create`                         |
| Edit details, certifications, time off | `crew.edit`                           |
| See or change rates and pay links      | `crew.edit` and `crew.view_sensitive` |
| Archive or restore                     | `crew.archive`                        |

Project managers can add and edit crew but don't see rates or emergency contacts. The **Crew coordinator** default role holds every crew permission.

Every change is audited against the crew member: `crew_member.created`, `.updated`, `.archived`, `.restored`, `crew_rate.added`, `.ended`, `crew_certification.added`, `.removed`, `crew_unavailability.added`, `.removed`.
