# Integrations

What HMBL OS connects to, and how (spec §22). Administration → **Integrations** (`/admin/integrations`, `organisation.view`) shows each one with an honest status, worked out from the configuration and the database (`src/server/integrations/status.ts`), never from a setting someone typed:

| Status        | Meaning                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| Working       | Built into HMBL OS and in use without any outside account                                            |
| Not set up    | HMBL OS is ready for it, but no provider is configured, so nothing is sent and nothing claims it was |
| Not connected | No connection exists. The card says what to do instead                                               |

The spec allows an integration only once its API, credentials and permitted scopes are confirmed. None have been, so Stage 8 builds only what needs no outside account. Each card names the use, the source of truth and the direction data moves.

## Working

| Integration                | Use                                                              | Source of truth                       | Direction         | Where                                        |
| -------------------------- | ---------------------------------------------------------------- | ------------------------------------- | ----------------- | -------------------------------------------- |
| CSV and spreadsheet import | Clients, vendors, contacts, crew and equipment from spreadsheets | HMBL OS, once a batch is committed    | In                | [imports.md](imports.md)                     |
| Opening balances           | The books from the old system at cut-over                        | Old system to cut-over, HMBL OS after | In, once          | [migration.md](migration.md)                 |
| Reports and day book (CSV) | The accountant's own books and checks                            | HMBL OS                               | Out, as downloads | [financial-reports.md](financial-reports.md) |
| Bank statements (CSV)      | Bank reconciliation                                              | The bank                              | In, by file       | [banking.md](banking.md)                     |
| Calendar feed (iCalendar)  | Show dates, phases and milestones in people's own calendars      | HMBL OS                               | Out, read-only    | Below                                        |

## Not set up

**Email.** Notifications can be sent by email to people who choose it, with retries ([notifications.md](notifications.md)). Version 1 has no mail provider: `emailTransport()` in `src/server/notifications/delivery.ts` returns none, so each queued email is marked "not sent" and is never shown as delivered. The card shows how many people chose email and how many emails weren't sent in the last 30 days. Connecting a provider means implementing that transport; the status then turns to Working by itself.

## Not connected

Google Calendar sync, Gmail, Google Drive, Google Sheets, Tally export, live bank feeds, payment providers, and WhatsApp or SMS. Each needs an account, scopes and an agreed source of truth and conflict rule before it is built. The Tally export waits for the accountant to confirm the Tally version and import format; the day book covers the same entries meanwhile.

## Calendar feed

Under the account menu, **Calendar feed** (`/account/calendar`). A staff member with `projects.view` makes a private link and adds it to Google Calendar, Outlook or Apple Calendar as a subscription by URL. The service is `src/server/integrations/calendar-feed.ts`; the route is `/api/calendar/{secret}.ics`.

- **What's in it.** The show dates, phases and milestones of every project the person can see, except cancelled ones, from 60 days back to about 18 months ahead, as all-day events. Each has the title, project number and name, venue and a link to the project's schedule. Notes, amounts and contacts are never included. A ticked-off milestone starts with "Done:".
- **Permissions on every fetch.** Calendars fetch without a session, so the route is outside the sign-in redirect (`src/proxy.ts`). Each fetch loads the link's owner, refuses if they are disabled or not staff, and reads their roles again (with the two-factor rule), so a change of role shows at the calendar's next refresh.
- **The secret.** 32 random bytes; only a SHA-256 hash is stored. The link is shown once. Making a new link replaces the old one, which stops working at once; turning it off deletes it. An unknown link gets 404.
- **One way.** HMBL OS is the source of truth. Nothing made in the calendar comes back. Calendars refresh on their own schedule, usually every few hours.
- **Reach.** Google Calendar fetches the link from Google's servers, so it can read it only once HMBL OS is reachable on the internet.
- **Use.** The last fetch is kept to the hour and shown on the page.
- **Audit.** `calendar_feed.created`, `.replaced` and `.revoked`.
