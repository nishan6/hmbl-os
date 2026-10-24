# Travel and accommodation

Trips for projects (spec §15): who travels, flights, trains, hotels and ground transport, rooms, booking references, the travel budget, and what changes and cancellations cost. The service is `src/server/logistics/travel.ts`; the rules that need no database are in `src/lib/travel.ts` and the time zone helpers in `src/lib/time-zone.ts`, both with unit tests. Screens are under **Travel & Logistics**, and each project has a **Travel** tab.

## Trips

A trip belongs to one project, so its legal entity and currency are the project's. It has a purpose, first and last day, a route, an **estimate** (the travel budget for the trip, before tax) and the **budget line** that pays for it, usually a Travel or Logistics line.

```
DRAFT ──submit──▶ SUBMITTED ──approve──▶ APPROVED ──complete──▶ COMPLETED
  ▲                  │reject               │
  └──────────────────┘                     └──cancel──▶ CANCELLED
```

- **Planning** (`logistics.edit`, held by Project managers): start the trip, add travellers and hold bookings.
- **Submitting** needs at least one traveller and a budget line.
- **Approving**: the project's manager, or anyone with `logistics.approve` (the Owner by default). Approval numbers the trip `TRV/{FYY}/{SEQ:5}`. Rejecting sends it back to draft with a reason.
- The estimate and budget line change only while the trip is a draft. Dates, route and notes can change while the trip is open.
- **Completing** needs every held booking to be confirmed or cancelled.
- **Cancelling** a trip drops its held bookings. Confirmed bookings must be cancelled one by one first, so each cancellation charge is recorded.

## Travellers

A traveller is a crew member (name, phone and email come from their record) or a named guest such as an artist or a client. Preferences hold seat, meal and similar needs.

**Identity documents** (document type and number, expiry, nationality, visa reference) are sensitive. Only `logistics.view_sensitive` (the Owner by default) can see or enter them. Everyone else sees "on file" or "None", and when they edit a traveller the documents are left as they were. The audit log records which identity fields changed, never their values.

## Bookings

A booking is a flight, train, hotel stay, ground transfer or other item, with the vendor who bills for it (often a travel agent), the provider, the booking reference (PNR or confirmation), and who it is for.

- **Times** are entered as the local time where the journey leaves and arrives, each with its IANA time zone (default Asia/Kolkata). They are stored in UTC with the zone, and shown in the zone they happen in with its abbreviation, so an itinerary across cities or countries reads correctly. Journey length is worked out from the stored instants. A local time skipped by a daylight-saving change moves forward; a repeated one takes the first.
- **Hotels** have check-in and check-out dates and a number of rooms. Guests are put in rooms by room label; more rooms than booked are refused. The itinerary orders hotels as if check-in were 14:00.
- **Ground transport** has a pick-up address, vehicle, driver and driver's phone.
- A booking starts **held**: an option or quote that commits nothing. Held bookings can be added and changed at any time while the trip is open.
- **Confirming** needs an approved trip, a booking reference and at least one traveller. A confirmed booking with a cost commits that cost to the trip's budget line (`project_cost_entries`, source `travel_booking`), which needs the project's budget to be approved. The agent's or hotel's bill then draws the commitment down instead of adding to it.
- **Changing** a confirmed booking needs a reason; the change charge is added to the new cost, and the commitment is replaced by what is now owed (`replaceDocumentCommitment`). Every change is kept in an append-only history (`travel_booking_changes`, protected by a trigger).
- **Cancelling** a confirmed booking records the cancellation charge as its cost and replaces the commitment with it, or releases it when there is no charge.

## Bills

Finance (`finance.create`) drafts a vendor's bill from the trip page: **Draft the bill from** a vendor makes one line for each confirmed or cancelled booking through that vendor that isn't on a bill yet, on the trip's budget line and drawing down the booking's commitment (`src/server/logistics/billing.ts`). Lines start on account 5040 (Accommodation and meals) for hotels and 5030 (Travel) for everything else, with no GST rate: GST on travel depends on the service and class, so Finance sets it from the supplier's invoice, with the invoice number, before submitting.

## Money

The trip's cost is its confirmed bookings plus cancellation charges. Held bookings are shown separately as what they would add. The trip page shows the estimate, what is booked, what is held and what is left, plus the budget line's revised budget, commitments and actual cost. Confirmed bookings above the estimate show a warning; they are not blocked.

Costs and estimates are shown to people who see the project's costs or plan travel; others see dashes.

## Audit

`travel_request.created`, `.updated`, `.submitted`, `.approved`, `.rejected`, `.completed`, `.cancelled`, `.traveller_added`, `.traveller_updated`, `.traveller_removed`, and `travel_booking.added`, `.updated`, `.confirmed`, `.changed`, `.cancelled`, `.rooms_allocated`, all with the trip as the target.
