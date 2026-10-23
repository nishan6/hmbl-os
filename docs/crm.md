# CRM

## Clients and contacts

Clients are **group-wide**: one client can work with several HMBL entities, so a CRM permission held for any entity is enough to see and maintain them. What HMBL sells to a client (opportunities, quotes, projects) belongs to one legal entity and is checked against that entity.

| Record               | Notes                                                                                                                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client (`clients`)   | Company or individual. Starts as a **prospect** and becomes a **client** when it accepts a quote. Tax ID type and value (GSTIN format is checked), billing address with the GST state, quote currency, account owner. |
| Contact (`contacts`) | A person at a client. The first contact becomes primary; at most one active primary per client, enforced by a partial unique index.                                                                                   |

| Action                       | Permission                   |
| ---------------------------- | ---------------------------- |
| See clients and contacts     | `crm.view`                   |
| Add a client or contact      | `crm.create`                 |
| Edit, make a contact primary | `crm.edit`                   |
| Archive or restore           | `crm.archive`                |
| Merge a duplicate            | `crm.edit` and `crm.archive` |

### Duplicates

Creating a client checks for active clients with the same name once case, punctuation and company suffixes ("Pvt Ltd", "LLC", "FZ-LLC"…) are ignored (`normalizeClientName`), the same tax ID, or the same website domain. If any match, the form lists them and asks the user to confirm the new client is a different organisation; the audit event then records `duplicateConfirmed`. Two active clients can never share a tax ID: the database refuses it.

### Merging

`mergeClient` moves everything that points at the duplicate to the client being kept (`CLIENT_REFERENCES` in `src/server/crm/clients.ts`; later modules add their tables there), fills empty details on the survivor from the duplicate, then archives the duplicate with `mergedIntoId` set. Nothing is deleted. A reason is required, both records get an audit event (`client.merged`, `client.merge_received`) with the reason and counts of what moved, and a merged record can't be restored.

### Screens

| Path                     | Shows                                                           |
| ------------------------ | --------------------------------------------------------------- |
| `/crm/clients`           | Search by name, contact or tax ID; filter prospects and clients |
| `/crm/clients/new`       | Create a client                                                 |
| `/crm/clients/[id]`      | Details, contacts, archive and merge                            |
| `/crm/clients/[id]/edit` | Edit a client                                                   |

## Demo data

`pnpm db:seed` adds three fictional clients with contacts, all flagged `isDemo` and owned by the demo sales user.
