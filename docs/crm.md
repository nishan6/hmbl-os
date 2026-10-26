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

## Pipeline

### Stages

Stages are group-wide configuration (`pipeline_stages`), edited in **Administration → Master data** by someone with `crm.configure` for every entity. Each has a **kind** that never changes: open, won, lost, on hold (deferred) or cancelled. The defaults follow the spec — New → Qualified → Discovery → Estimation → Proposal sent → Negotiation → Won / Lost / On hold, plus Cancelled — with labelled default probabilities (10% to 80% for the open stages). Stages can be added, reordered and archived. A stage with opportunities in it can't be archived, and the pipeline always keeps at least one open, one won and one lost stage.

### Opportunities

An opportunity belongs to the **legal entity** that would contract the work; every read and write checks `crm.*` for that entity, and one outside the user's entities is reported as not found. It records the client and contact, owner, business line, source, expected value and currency, win probability (blank uses the stage's default), expected decision date, event dates, venue and competitors. An opportunity can't move to another entity.

### Transition rules (`src/server/crm/transitions.ts`)

| Move                                          | Rule                                               |
| --------------------------------------------- | -------------------------------------------------- |
| Between open stages, either direction         | Allowed                                            |
| To won                                        | Reason optional; sets `closedAt`                   |
| To lost, on hold or cancelled                 | Reason required; stored as the outcome reason      |
| Out of won, lost or cancelled (reopening)     | Reason required; clears `closedAt` and the outcome |
| To an archived stage, or to the current stage | Refused                                            |

Every move writes a row to `opportunity_stage_changes` (shown as the opportunity's history) and an audit event (`opportunity.stage_changed` or `opportunity.reopened`). Editing an opportunity never changes its stage.

### Four different values

The spec asks that these never be mixed up. The pipeline shows only the first.

| Value                   | Where it comes from                                                        |
| ----------------------- | -------------------------------------------------------------------------- |
| Opportunity value       | `opportunities.expectedValueMinor`: the salesperson's estimate, before tax |
| Quoted value            | The latest quote version ([commercial.md](commercial.md))                  |
| Approved contract value | The accepted quote version                                                 |
| Recognised revenue      | Finance ([ledger.md](ledger.md), revenue recognition)                      |

Totals are always shown per currency; amounts in different currencies are never added together. The weighted value is each opportunity's value times its win probability.

### Activities

Notes, calls, meetings, emails and follow-ups (`crm_activities`) belong to a client and optionally to one opportunity. An activity on an opportunity is visible only to people who can see that opportunity's entity, even on the shared client page. A follow-up needs a due date; open follow-ups assigned to you appear on the home page and can be marked done.

### Screens

| Path                           | Shows                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `/crm`                         | Board of open stages with per-currency totals; on hold and closed below. Follows the entity switcher |
| `/crm/opportunities/new`       | Capture an enquiry (`?clientId=` preselects the client)                                              |
| `/crm/opportunities/[id]`      | Details, stage move, activity and stage history                                                      |
| `/crm/opportunities/[id]/edit` | Edit details                                                                                         |

## Demo data

`pnpm db:seed` adds three fictional clients with contacts and four opportunities across the pipeline, all flagged `isDemo` and owned by the demo sales user.
