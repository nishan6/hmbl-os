# Production and show day

The show day (spec §16) is what the people at a venue need on one screen, without the rest of the project: venue and dates, the running order, crew calls, equipment, travel, movements, contacts, notes, documents and what is happening now. Screens are under **Production** (`/production`), one show per project (`/production/[projectId]`). The services are in `src/server/production/`, and the pure rules (venue times, show days, call-sheet comparison) in `src/lib/production.ts`.

## Who sees what

| Permission          | What it allows                                                                   |
| ------------------- | -------------------------------------------------------------------------------- |
| `production.view`   | Open the show day of projects in the entity                                      |
| `production.create` | Post status updates and add notes (the crew at the venue)                        |
| `production.edit`   | Keep the run of show, publish call sheets, pin, change and archive anyone's note |

The show day is its own permission so venue crew can see what they need without the rest of the project. The default **Show crew** role holds `production.view` and `.create`, project and document view, and expense claims. Project managers hold all of `production`. Crew coordinators can view; the warehouse can view and post.

The show day reads crew, equipment, travel and logistics records but shows only what is needed at the venue. It never shows costs, rates, emergency contacts, identity documents or booking references (PNRs and confirmation numbers). Links to full records (a movement, the project) appear only to people who may open them. Documents appear only to people who may see the project's documents, and only the venue categories: technical, call sheet, equipment checklist, travel, deliverable and other.

Writes are refused once the project is closed or cancelled.

## Show days

A show's days are every day of its schedule's shows and phases (build, rehearsal, de-rig), or else its event dates. Milestones aren't show days. The page opens on today when the show runs today, else the next show day, else the last one; any day can be picked. "Today" is in the legal entity's time zone.

The **Shows** list has "Today and coming up" and "Past", for approved projects up to completed (not draft, closed or cancelled).

## Run of show

The running order for each day: a venue wall-clock time (`19:30`), an optional length in minutes (shown as an end time, `+1` past midnight), what happens, who runs it, where, and notes. Times are typed as `7:30`, `07:30` or `0730`. A database CHECK keeps times well formed. Entries are on days near the show (within a month of the event dates), to catch typos. Each add, change and removal is audited.

## Call sheets

The live list is the day's confirmed crew bookings, with call time, role, who they report to and phone. **Publishing** freezes it, with general call information (parking, catering, safety briefing), as the next numbered revision. Revisions are never changed (a database trigger refuses updates and deletes). The show day shows the latest published revision, and warns when bookings have changed since, so everyone works from one agreed sheet. Publishing again with nothing changed is refused. Only published sheets go into the offline show pack.

## Notes and status updates

**Production notes** are what the crew at the venue should know: access, power, parking, client preferences. Anyone who can post adds notes; the author or a planner changes or archives them; only planners pin a note to the top. Archived notes stay in the log.

**Status updates** say what is happening now: On track, Delayed, Issue, Done for the day or Information, with a line of text. The newest update is the show's current status and shows on the Shows list. Updates are never changed (trigger-protected).

The **show log** puts status updates and show-day changes (run of show, call sheets, notes) in one timeline, newest first.

## Audit

`production.run_of_show_added`, `.run_of_show_changed`, `.run_of_show_removed`, `.call_sheet_published`, `.note_added`, `.note_changed`, `.note_archived` and `.status_posted`, each with `projectId` in the metadata.

## Demo data

`pnpm db:seed` gives the first demo project a running order on its first show day, two notes (one pinned), a published call sheet when crew are confirmed that day, and a status update. The demo user `show@demo.hmbl.test` has the Show crew role.
