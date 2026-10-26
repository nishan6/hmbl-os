# Authentication and permissions

## Sign-in

- Better Auth, email and password only (`src/server/auth/auth.ts`). Passwords are hashed by Better Auth; HMBL OS never handles hashes itself except to pass one through when an administrator creates an account.
- **Public sign-up is disabled.** The first owner is created from the command line:

  ```bash
  HMBL_NEW_USER_PASSWORD='a long passphrase' pnpm user:create --name "Full Name" --email you@example.com --role owner
  ```

  Everyone else is invited from **Administration → Users** (see [Staff accounts](#staff-accounts)).

- Sessions are stored in Postgres (`sessions` table), last 12 hours and refresh hourly while in use. Disabling a user deletes all their sessions, and a disabled user cannot start a new one.
- Sign-in attempts are rate limited per IP (10 per minute, stored in Postgres). Rate limiting is off only when `APP_ENV=test`.
- The sign-in form shows one message for every failure so it doesn't reveal which emails have accounts.
- `src/proxy.ts` redirects requests with no session cookie to `/sign-in`. That is a convenience only; it is not the security boundary.

## Staff accounts

Administration → **Users** (`/admin/users`) lists everyone who signs in to HMBL OS. The service is `src/server/users/links.ts` (links and passwords) and `src/server/users/service.ts` (roles and status); its tests are `tests/integration/staff-accounts.test.ts` and `tests/e2e/users.spec.ts`.

- **Inviting** (`users.create` and `users.configure`): name, email and one role, for every legal entity or one. HMBL OS sends no email in Version 1, so the page shows a link once, to copy and send by hand. It works once, for 7 days. The person opens it, types the address it was made for, and chooses their name and password; the account is created with the role, granted by the inviter. More roles can be granted afterwards.
- **Roles** are granted and removed on the person's page. Nobody can grant a role with permissions they don't hold themselves, for wider entities than they hold them, and HMBL OS always keeps one active owner.
- **Forgotten password or lost phone** (`users.configure`): the person's page makes a one-use password link, valid for 24 hours, optionally also removing their authenticator app. Using it sets the new password and ends all their sessions. Only someone who could grant every role the person holds may do this, so an administrator can't take over an owner's account. Making a new link withdraws the old one.
- **Disabling** (`users.archive`) signs the person out everywhere at once and stops them signing in; their records and history stay. **Enabling** lets them back in with the roles they still hold.
- **Changing your own password**: Account menu → **Sign-in security**. The current password is checked; every other session is ended.
- Links are stored as a SHA-256 hash only. A link stops working if it expires, is withdrawn, the account is disabled, or the person who made it has since lost the right to. The database refuses any change to a used or withdrawn link, or deleting one (`account_links_guard`).

## Two-factor sign-in

- After the password, users with two-factor enter a 6-digit code from a free authenticator app (Google Authenticator, Microsoft Authenticator, 1Password and similar). No SMS and no paid service: it is Better Auth's `twoFactor` plugin.
- **Required for Owner, Administrator and Finance** (`TWO_FACTOR_REQUIRED_ROLES` in `src/server/auth/two-factor-policy.ts`, a labelled default in the [decision register](decisions.md)). Until such a user sets it up, `getActor()` gives them **no permissions** and the app shows only the setup screen, so every page and service refuses them on the server. They can't turn it off; the `/two-factor/disable` endpoint returns 403 for them.
- Everyone else can turn it on or off at **Account menu → Sign-in security**.
- Setup: confirm password, scan a QR code (or type the key), enter one code to prove the app works, then save ten one-use backup codes.
- Secrets and backup codes are encrypted with `BETTER_AUTH_SECRET` before they are stored. Losing that secret means everyone sets up two-factor again.
- "Don't ask again on this device" skips the code for 30 days on that browser.
- Wrong codes are limited per sign-in attempt and per account (Better Auth locks the account's code check for 15 minutes after 10 failures).
- Audit events: `auth.signed_in` is written only once the code is accepted; `auth.two_factor_failed`, `user.two_factor_enabled`, `user.two_factor_disabled` and `user.backup_codes_regenerated` are also recorded (`src/server/auth/audit-plugin.ts`).

## Permissions

- Permission keys are `<module>.<action>`, listed in `src/server/permissions/catalog.ts`. Actions follow the spec: view, create, edit, submit, approve, reject, issue, post, void, archive, export, configure, view_sensitive. Each module lists only the actions that make sense for it (only Finance can `post` or `void`).
- A **role** is a named set of permission keys stored in the database. A user can hold several roles; their permissions are the union.
- **Deny by default.** No wildcards and no implied actions: `finance.edit` does not grant `finance.post`.
- Checks run on the server: `requirePermission("crm.view")` in actions and route handlers, `authorize(actor, …)` inside services. Hiding a button is never the check.
- **No privilege escalation:** a user can only grant a role whose permissions they already hold, over entities they already cover, so an Administrator cannot make someone an Owner and an entity-scoped owner cannot grant group-wide roles.
- HMBL OS always keeps at least one active all-entities Owner: the last one cannot be disabled or lose the role.

## Default roles

Created once if missing by `pnpm db:seed` or `pnpm user:create`, then editable. They are labelled defaults, not approved policy (see [decisions](decisions.md)).

| Role             | Intent                                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| Owner / Director | Every permission                                                                                          |
| Administrator    | Users, roles, organisation and audit; view-only elsewhere, no approvals or posting                        |
| Finance          | Finance and reports in full, sensitive commercial/project/crew figures, procurement approval and settings |
| Sales            | CRM, quotations up to submit and issue (not approve), project view                                        |
| Project manager  | Projects up to submit, production, crew, equipment, procurement and logistics requests                    |
| Crew coordinator | Crew records, rates and availability in full; project and show-day view                                   |
| Warehouse        | Equipment, stock and maintenance in full, including return to service; project view; show-day posts       |
| Procurement      | Vendors (not bank details or TDS), purchase orders up to submit, amendments and receipts                  |
| Show crew        | The show day: view, status updates and notes; project and document view                                   |
| Viewer           | View-only, no sensitive data, no users or audit                                                           |

## Portal users

People outside HMBL sign in to the portal only. They are external users, hold no role and are never actors inside HMBL OS; see [portal.md](portal.md).

## Entity scope

A role can be granted for all legal entities or for one. `authorize(actor, perm, { legalEntityId })` checks a specific entity; `entityFilter(actor, perm)` narrows a query to the entities the actor reaches; `authorizeEverywhere` demands an all-entities grant for group-wide changes. Details in [organisation.md](organisation.md).

## Audit

Sign-ins (successful, failed and blocked), user creation, invitations and their use, role grants and revocations, disabling and enabling a user, password links, resets and changes are all recorded. See [audit-log.md](audit-log.md).
