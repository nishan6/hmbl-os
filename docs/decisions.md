# Decision register

Policies HMBL Group has not decided yet. Each has a labelled, configurable default so engineering can continue. None of these defaults is an approved company policy.

| Decision                    | Default in code                                                | Why it is reasonable                        | If the answer differs                           | Blocks     |
| --------------------------- | -------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------- | ---------- |
| Hosting                     | None. Local and CI only                                        | Avoids lock-in before a choice              | Add deployment config for the chosen host       | Staging    |
| Sign-in method              | Email and password; no public sign-up                          | Works with no external provider             | Add Google or SSO through Better Auth           | Production |
| Multi-factor authentication | Not enabled yet                                                | Needs a decision on which roles must use it | Enable Better Auth two-factor for those roles   | Production |
| Session length              | 12 hours, refreshed hourly while active                        | A working day without repeated sign-ins     | Change `session` in `src/server/auth/auth.ts`   | No         |
| Password policy             | 12 to 128 characters                                           | Length over complexity rules                | Change `minPasswordLength` and the Zod schema   | No         |
| Roles and permissions       | Six default roles in `src/server/permissions/default-roles.ts` | Mirrors the user groups in the spec         | Edit roles in the database (admin UI to follow) | Production |
