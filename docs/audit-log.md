# Audit log

Every important change writes one row to `audit_events`, in the same database transaction as the change. If the change fails, no event is written; if the event can't be written, the change rolls back.

## What an event holds

| Field                                | Meaning                                                                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `occurredAt`                         | Server time, with time zone                                                                                                   |
| `actorType`, `actorId`, `actorLabel` | `USER` (with name and email as they were at the time), `SYSTEM` (bootstrap scripts and seed) or `ANONYMOUS` (failed sign-ins) |
| `action`                             | Dotted verb, such as `legal_entity.updated` or `user.role_granted`                                                            |
| `targetType`, `targetId`             | The record the action was about                                                                                               |
| `legalEntityId`                      | Set when the event concerns one legal entity                                                                                  |
| `changes`                            | `{ field: { from, to } }` for the fields that changed. Fields that look like secrets are recorded as `[redacted]`             |
| `metadata`                           | Reason, role and scope for grants, IP address and user agent                                                                  |

`actorId` has no foreign key on purpose: the log must survive any later change to users.

## Protection

- A Postgres trigger rejects every `UPDATE` and `DELETE` on `audit_events`, including raw SQL from the application.
- `TRUNCATE` is not blocked by the trigger; tests use it to reset the test database. In production the application's database role must not be granted `TRUNCATE` or table ownership. That is a deployment task once hosting is chosen.
- IP addresses come from `X-Forwarded-For` as the request reported it. They are only trustworthy behind a proxy that sets the header, which depends on the host.

## Who can read it

`listAuditEvents()` in `src/server/audit/query.ts`, newest first with cursor paging and filters for target, actor, action, entity and date range.

- Events tied to a legal entity: anyone with `audit.view` for that entity.
- Group-wide events (users, roles, business units, sign-ins): only `audit.view` across every entity.

## What is recorded today

| Area         | Actions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in      | `auth.signed_in`, `auth.sign_in_failed`, `auth.sign_in_blocked`                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Users        | `user.created`, `user.role_granted`, `user.role_revoked`, `user.disabled`                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| CRM          | `client.created` (with `duplicateConfirmed`), `.updated`, `.archived`, `.restored`, `.merged`, `.merge_received`; `contact.created`, `.updated`, `.archived`, `.restored` (target is the client, `metadata.contactId` the contact); `opportunity.created`, `.updated`, `.stage_changed`, `.reopened`; `crm_activity.created`, `.completed`; `pipeline_stage.created`, `.updated`, `.reordered`, `.archived`, `.restored`                                                                                                            |
| Commercial   | `quote.created`; `quote.draft_saved` (field changes to the version and its totals, `metadata.version`, `metadata.lines` before and after); `quote.submitted`, `.approved` (with `selfApproval`), `.rejected`, `.issued`, `.withdrawn`, `.revised` (`metadata.version`, comment or reason); `quote.accepted` (date, accepted by, method, PO, `afterValidity`), `quote.declined` (reason); `commercial_settings.updated`. Acceptance also writes `project.created`, `opportunity.stage_changed` and, for a prospect, `client.updated` |
| Projects     | `project.created` (`metadata.source = "quote"`, quote id and version, counts of budget lines and milestones)                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Master data  | `tax_rate.created`, `.default_set`, `.archived`, `.restored`; the same for `payment_term`; `unit.created`, `.archived`, `.restored`                                                                                                                                                                                                                                                                                                                                                                                                 |
| Numbering    | `numbering_scheme.created` (with `metadata.source = "default"` when added automatically), `numbering_scheme.archived`                                                                                                                                                                                                                                                                                                                                                                                                               |
| Organisation | `legal_entity.created`, `.updated`, `.archived`, `.restored`; `tax_registration.created`; `business_unit.created`; `department.created`; `cost_centre.created`; `location.created`                                                                                                                                                                                                                                                                                                                                                  |

Sign-in events are written outside a business transaction. If one can't be written, the error is logged and the sign-in still proceeds.

## Adding audit to new code

```ts
await db.$transaction(async (tx) => {
  const after = await tx.thing.update({ where: { id }, data });
  await recordAudit(tx, actor, {
    action: "thing.updated",
    targetType: "thing",
    targetId: id,
    legalEntityId: after.legalEntityId,
    changes: diffChanges(before, after, THING_FIELDS),
  });
});
```

Skip the event when `diffChanges` returns null, so no-op saves don't add noise.
