# Offline show packs and the field app

Venues often have poor or no signal. The **field app** (`/field`) keeps each show a person works on, on their phone or laptop, so the show day still opens without a connection. It is linked from Production as "Field app (works offline)".

Everything here is a default, not yet confirmed by HMBL (see [decisions.md](decisions.md): "Offline scope", "Offline data on devices", "Offline changes").

## What works offline

| Works with no connection                                                             | Needs a connection                                                            |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Opening the field app, once it has been opened while connected on this device        | The first visit to the field app on a device                                  |
| The list of saved shows                                                              | Downloading or refreshing a show (Refresh, or automatically when back online) |
| For each saved show day: the run of show, the published call sheet with crew phones  | Live crew bookings that were not published on a call sheet                    |
| Equipment booked that day (counts out and back), confirmed travel, and movements     | Anything outside the field app: the rest of HMBL OS is online only            |
| Notes, the current status, recent show updates, and project manager and producer     | Documents and files, incidents, costs, rates and budgets                      |
| Ticking and unticking checklist items (for people who can post on the show)          | Changing checklists, the run of show or call sheets (planners, online)        |
| Posting status updates and notes, and reporting incidents; they are sent when online | Seeing other people's changes made since the show was last saved              |

A show is saved when it has a show day from **yesterday to two weeks ahead**, the project is open (not closed or cancelled), and the person can open its show day (`production.view` in the project's entity). Times are shown in the entity's time zone; journeys in their own zones.

## What is never stored on a device

The pack is built on the server by `buildShowPack` (`src/server/production/pack.ts`), which picks fields one by one rather than copying records. It leaves out:

- rates, costs, budgets and anything with money;
- emergency contacts, identity documents (passports, visas) and travel booking references or PNRs;
- incidents, including their titles in the show log, because they can name people involved;
- document files;
- crew bookings that have not been published on a call sheet.

`tests/integration/show-pack.test.ts` checks the pack against these.

## How it works

- **Pack API.** `GET /api/production/packs` lists the shows the signed-in user may keep offline. `GET /api/production/packs/[projectId]` returns one show's pack. Both are `private, no-store` and check the session themselves (the proxy lets them through so they can answer 401 rather than redirect).
- **Device storage.** The app keeps packs in IndexedDB (`hmbl-field`), one per show, each stamped with the user's id and when it was saved (`src/lib/offline/store.ts`).
- **Service worker.** `public/sw.js` is registered with scope `/field` only, so the rest of HMBL OS never goes through it. It serves the field app's page network first, falling back to the last copy kept, and its scripts and styles from the cache. API responses are never cached by the service worker.
- **Refreshing** (`src/lib/offline/refresh.ts`) happens when the app opens online, when the device comes back online, and on Refresh. A show that fails to download keeps its last copy.

## Changes made offline

Ticks, status updates, notes and incident reports made in the field app go into a queue on the device first (`src/lib/offline/operations.ts`, `send.ts`). The show shows them straight away, marked **Not sent**, and the header counts them. The queue is sent when the app opens online, when the connection comes back, on Refresh, and every 15 seconds while changes wait.

- **Sending once.** Each change gets an id on the device when it is made. `POST /api/production/sync` applies an id once and stores the answer under it (`offline_operations`, which can't be changed or deleted), so a resend after a dropped connection, or the same change from two tabs, returns the first answer and changes nothing. Ticking and unticking the same item before it is sent cancels out on the device.
- **Checked as they arrive.** The server applies each change through the same service as the online screens: the user's permissions and the show's state are checked as they are when the change arrives, not when it was made. Each change is audited with `offline: true`, its id and when it was made on the device. A tick records the time it was made at the venue.
- **Conflicts.** A tick carries the item's version on the device. If someone else changed the item since, and the tick would undo their change, nothing is changed and the change waits as a **Conflict**, showing who did what. The user chooses **Use mine** (sent again from the current version) or **Keep theirs** (discarded). Ticking what someone else already ticked is not a conflict.
- **Refused changes.** A change the server won't accept (access removed, show closed, something missing) waits as **Not accepted** with the reason. The user chooses **Try again**, sent as a new change, or **Discard**.
- **Failed sends.** When the network or the server fails, changes stay pending and are tried again after 5 seconds, then 10, 20 and so on, up to every five minutes. They are never lost by a failed send.
- **Session ended.** If the server answers 401, the shows are wiped but the queue is kept, so the same user sends it after signing in again. Another user signing in on the device drops it.
- **Sensitive data.** An incident report, including who was involved, stays on the device only until the server accepts it. Signing out with changes not sent asks first, then deletes them.

`tests/integration/offline-sync.test.ts` covers the server's side (applying, duplicates, conflicts, refused changes, permission changes); `tests/unit/offline-queue.test.ts` the device's (queuing, retries, recovery); and `tests/e2e/field.spec.ts` the app offline in a browser.

## When offline data is deleted

| When                                                                              | What is deleted                                                                                     |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| The user signs out (any sign-out button), after a warning if changes are not sent | Everything: packs, changes not sent, the cached app, the service worker                             |
| The server answers 401 (signed out elsewhere, session expired, disabled)          | Packs and the cached app; changes not sent are kept for the same user, then the app goes to sign-in |
| Another person signs in on the same device                                        | The previous person's packs and changes not sent                                                    |
| Opening the field app redirects (signed out, or no longer staff)                  | Packs and the cached app (the service worker clears them)                                           |
| A change is accepted by the server                                                | That change, from the queue                                                                         |
| The user loses access to a show, or the show leaves the window or closes          | That show's pack, at the next refresh                                                               |
| A pack has not been refreshed for 72 hours                                        | That pack, without being shown                                                                      |

## Limits

- Data on the device is not encrypted by HMBL OS; it relies on the device's own lock and storage encryption. This is why the pack leaves out sensitive records and why it is deleted on sign-out and after 72 hours.
- A device that never reconnects keeps a show until it expires, even if access was removed meanwhile. Access changes take effect at the next refresh.
- Browsers can clear site data under storage pressure; the app then shows no saved shows until it is online again.
