# Authentication and permissions

## Sign-in

- Better Auth, email and password only (`src/server/auth/auth.ts`). Passwords are hashed by Better Auth; HMBL OS never handles hashes itself except to pass one through when an administrator creates an account.
- **Public sign-up is disabled.** Accounts are created by a user with `users.create`, or from the command line for the first owner:

  ```bash
  HMBL_NEW_USER_PASSWORD='a long passphrase' pnpm user:create --name "Full Name" --email you@example.com --role owner
  ```

- Sessions are stored in Postgres (`sessions` table), last 12 hours and refresh hourly while in use. Disabling a user deletes all their sessions, and a disabled user cannot start a new one.
- Sign-in attempts are rate limited per IP (10 per minute, stored in Postgres). Rate limiting is off only when `APP_ENV=test`.
- The sign-in form shows one message for every failure so it doesn't reveal which emails have accounts.
- `src/proxy.ts` redirects requests with no session cookie to `/sign-in`. That is a convenience only; it is not the security boundary.

## Permissions

- Permission keys are `<module>.<action>`, listed in `src/server/permissions/catalog.ts`. Actions follow the spec: view, create, edit, submit, approve, reject, issue, post, void, archive, export, configure, view_sensitive. Each module lists only the actions that make sense for it (only Finance can `post` or `void`).
- A **role** is a named set of permission keys stored in the database. A user can hold several roles; their permissions are the union.
- **Deny by default.** No wildcards and no implied actions: `finance.edit` does not grant `finance.post`.
- Checks run on the server: `requirePermission("crm.view")` in actions and route handlers, `authorize(actor, …)` inside services. Hiding a button is never the check.
- **No privilege escalation:** a user can only grant a role whose permissions they already hold, so an Administrator cannot make someone an Owner.
- HMBL OS always keeps at least one active Owner: the last one cannot be disabled or lose the role.

## Default roles

Created once if missing by `pnpm db:seed` or `pnpm user:create`, then editable. They are labelled defaults, not approved policy (see [decisions](decisions.md)).

| Role             | Intent                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------- |
| Owner / Director | Every permission                                                                             |
| Administrator    | Users, roles, organisation and audit; view-only elsewhere, no approvals or posting           |
| Finance          | Finance and reports in full, sensitive commercial/project/crew figures, procurement approval |
| Sales            | CRM, quotations up to submit, project view                                                   |
| Project manager  | Projects up to submit, production, crew, equipment, procurement and logistics requests       |
| Viewer           | View-only, no sensitive data, no users or audit                                              |

## Coming next

Entity-level scoping (a role granted for one legal entity only) arrives with legal entities. Every permission and role change will write to the audit log once it exists.
