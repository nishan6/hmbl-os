# Offline show packs and the field app

Venues often have poor or no signal. The **field app** (`/field`) keeps each show a person works on, on their phone or laptop, so the show day still opens without a connection. It is linked from Production as "Field app (works offline)".

Everything here is a default, not yet confirmed by HMBL (see [decisions.md](decisions.md): "Offline scope", "Offline data on devices").

## What works offline

| Works with no connection                                                            | Needs a connection                                                                                                 |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Opening the field app, once it has been opened while connected on this device       | The first visit to the field app on a device                                                                       |
| The list of saved shows                                                             | Downloading or refreshing a show (Refresh, or automatically when back online)                                      |
| For each saved show day: the run of show, the published call sheet with crew phones | Live crew bookings that were not published on a call sheet                                                         |
| Equipment booked that day (counts out and back), confirmed travel, and movements    | Anything outside the field app: the rest of HMBL OS is online only                                                 |
| Checklists with what was ticked when the show was saved                             | Ticking items, posting status updates and notes, reporting incidents (offline queueing comes with the next change) |
| Notes, the current status, recent show updates, and project manager and producer    | Documents and files, incidents, costs, rates and budgets                                                           |

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

## When offline data is deleted

| When                                                                     | What is deleted                                       |
| ------------------------------------------------------------------------ | ----------------------------------------------------- |
| The user signs out (any sign-out button)                                 | Everything: packs, the cached app, the service worker |
| The server answers 401 (signed out elsewhere, session expired, disabled) | Everything, then the app goes to sign-in              |
| Another person signs in on the same device                               | The previous person's packs                           |
| Opening the field app redirects (signed out, or no longer staff)         | Everything (the service worker wipes it)              |
| The user loses access to a show, or the show leaves the window or closes | That show's pack, at the next refresh                 |
| A pack has not been refreshed for 72 hours                               | That pack, without being shown                        |

## Limits

- Data on the device is not encrypted by HMBL OS; it relies on the device's own lock and storage encryption. This is why the pack leaves out sensitive records and why it is deleted on sign-out and after 72 hours.
- A device that never reconnects keeps a show until it expires, even if access was removed meanwhile. Access changes take effect at the next refresh.
- Browsers can clear site data under storage pressure; the app then shows no saved shows until it is online again.
