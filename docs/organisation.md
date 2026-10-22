# Organisation structure

HMBL OS separates the group, its legal entities and the ways work is organised. Shared master data never implies shared accounting ownership.

| Record                                 | Scope                    | Notes                                                                                                                                                    |
| -------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Group                                  | The deployment           | One HMBL OS installation is one group. There is no group table.                                                                                          |
| Legal entity (`legal_entities`)        | Owns books               | Code, legal and trading name, country, base currency (ISO 4217), time zone (IANA), address, status. Every financial record will carry a `legalEntityId`. |
| Tax registration (`tax_registrations`) | Per entity               | GSTIN, PAN, TAN, VAT and so on. The type is free text so a new jurisdiction is configuration, not code. Optional region and validity dates.              |
| Business unit (`business_units`)       | Group-wide               | A line of business. One unit can trade through several entities.                                                                                         |
| Department (`departments`)             | Group-wide               | Optional parent for teams.                                                                                                                               |
| Cost centre (`cost_centres`)           | Per entity               | Unique code within its entity, optionally tied to a business unit and department.                                                                        |
| Location (`locations`)                 | Per entity or group-wide | Office, warehouse or equipment store, studio, venue. Has its own time zone.                                                                              |

Records are archived, never deleted. Archiving a legal entity also stops any role granted for that entity from applying.

## Access

- A role can be granted for **all entities** or for **one entity** (`user_roles.legalEntityId`). The database allows each role once per user per scope.
- Entity-owned records are checked against the grant for that entity. A record in an entity the user can't see is reported as not found, so ids can't be probed.
- Group-wide records (business units, departments, locations with no entity) can only be created by someone whose grant covers every entity.
- Creating a new legal entity also needs an all-entities grant.
- Someone can only grant a role over entities where they already hold all of that role's permissions.

## Demo data

`pnpm db:seed` adds two fictional entities, `DEMO-IN` (INR, Mumbai) and `DEMO-AE` (AED, Dubai), with sample business units, departments, cost centres and warehouses, all flagged `isDemo`. The demo user `finance.in@demo.hmbl.test` holds Finance for `DEMO-IN` only.
