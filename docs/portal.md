# Portal access

How people outside HMBL (client contacts, vendors and freelancers) get a sign-in, and what keeps them out of everything else (spec §18, §19). The services are in `src/server/portal/`. What clients see and do is in [client-portal.md](client-portal.md); vendors and freelancers in [vendor-portal.md](vendor-portal.md).

## Two kinds of user

Every user is **staff** or **external** (`users.kind`), fixed when the account is created. Staff sign in to HMBL OS. External people sign in to the portal at `/portal` and nowhere else:

- `getActor()` returns nothing for an external user, so every internal page, server action and route handler treats them as signed out. Internal pages send them to `/portal`; internal APIs answer 401.
- External users hold no role. The role service refuses, and a database trigger (`user_roles_staff_only`) rejects any `user_roles` row for them, so no internal permission can ever reach a portal account. Another trigger stops a user's kind from changing.
- Portal pages use `getPortalActor()`, which needs an external user with an active portal account whose organisation is still active. Staff who open `/portal` are sent back to HMBL OS.
- Staff lists and pickers (users, project managers, owners, crew links, advances) only offer staff.

## Accounts belong to one organisation

A portal account (`portal_accounts`) belongs to exactly one of: a **client**, through one of its contacts; a **vendor**; or a **freelancer's** crew record. Check constraints enforce one organisation of the right kind, a trigger checks the contact belongs to the client, and another stops the organisation changing after creation. One person, one account, one organisation: someone who works for two clients needs two email addresses.

The portal actor carries the organisation from the account. Portal services filter by it and never take an organisation from the request.

## What they may do

Each account has its own list of portal permissions (`src/server/portal/permissions.ts`), chosen when inviting and changeable later. They are separate from the internal permission catalog and mean nothing inside HMBL OS.

| Kind       | Permissions                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Client     | See shared projects' status and milestones; see and accept or decline shared quotations; see invoices; download shared documents; send requested information |
| Vendor     | See purchase orders; confirm or decline them; upload invoices; see bill and payment status; update contact and compliance details                            |
| Freelancer | See their bookings and call information; confirm or decline proposed bookings; submit timesheets; see settlements; update their details                      |

Seeing invoices, payments and settlements is not ticked by default.

## Inviting

From a client's, vendor's or freelancer's page, **Portal access → Invite to the portal**. Inviting needs `portal.create` and the right to change that record (`crm.edit`, `procurement.edit` or `crew.edit`). Only freelancers are invited from crew records; employees are staff.

- Version 1 sends no email. The invitation link is shown once, to copy and send by hand. Only a SHA-256 hash of its secret is stored, never the link, and the audit log records the address and permissions, not the link.
- The link works once, for 14 days (`INVITATION_DAYS`). The invitation page shows who invited them, for which organisation and what they will be able to do, but not the address.
- To accept, the person must type the address the invitation was for, choose their name and a password. That address must not already belong to any account. The account is created, the invitation is marked used in the same transaction (so a link can't be used twice even by two people at once), and whoever invited them is notified. They then sign in as usual.
- An open invitation can be revoked. An address can have only one open invitation at a time.

## Changing and revoking access

`portal.edit` (plus the record's edit permission) changes what an account may do; it takes effect on their next page. `portal.archive` revokes an account with a reason: they are signed out everywhere, their user is disabled, and the account can't be restored (invite them again instead). Archiving the client, vendor or crew record also ends its people's access.

**Administration → Portal access** lists every account and open invitation the viewer may see, by the kind of record they can see.

## Audit

`portal_invitation.created`, `.revoked` and `.accepted` (by the new user), `portal_account.permissions_changed` and `portal_account.revoked` are all recorded.

## Demo

`pnpm db:seed` creates `client@demo.hmbl.test`, `vendor@demo.hmbl.test` and `freelancer@demo.hmbl.test` with the demo password and every portal permission.
