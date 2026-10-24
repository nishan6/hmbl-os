# Logistics

Movements for projects (spec §15): freight, equipment going to and from a venue, and local vehicles with drivers. Each records the carrier, consignment or tracking number, vehicle and registration, driver, pick-up and delivery addresses and times, the load, the cost and the budget line that pays for it, plus a tracking log. The service is `src/server/logistics/shipments.ts`. Screens are under **Travel & Logistics → Logistics**, and each project's **Travel** tab lists its movements under the trips.

## Movements

A movement belongs to one project, so its legal entity and currency are the project's. Its kind is **Freight**, **Equipment movement** or **Vehicle and driver**. An equipment movement can carry the project's reserved equipment bookings, so the warehouse sees what is on which truck.

Pick-up and delivery times are entered in local time with the IANA time zone of the place, stored in UTC, and shown in that zone, as for travel (`src/lib/time-zone.ts`). Delivery cannot be before pick-up.

```
PLANNED ──book──▶ BOOKED ──dispatch──▶ IN_TRANSIT ──deliver──▶ DELIVERED
   │                 │
   └──cancel─────────┴──cancel──▶ CANCELLED
```

- **Planning** (`logistics.edit`, held by Project managers): anything can change, including kind, cost and budget line.
- **Booking** needs a vendor on file or a named carrier. A movement with a cost also needs a budget line and an approved project budget: booking commits the cost to that line (`project_cost_entries`, source `shipment`). There is no separate approval step; the budget line and the project's approved budget are the control.
- After booking, the kind, cost and budget line are fixed in the edit form. **Changing the cost** (detention, waiting time, a re-quote) needs a reason, replaces the commitment and is logged with the old and new cost.
- **Dispatching** and **delivering** record when and, for delivery, who received it and in what condition. A delivered movement can still have its cost changed, for charges that arrive later.
- **Cancelling** a planned movement releases nothing because nothing was committed. Cancelling a booked one records an optional cancellation charge, which stays committed; without one the commitment is released.
- Anyone who plans can add a **tracking note** at any time while the project is open (held at the border, re-routed).

Every step and note goes into an append-only tracking log (`shipment_events`, protected by a trigger).

## Closeout

A project's "vendor bills received" closeout step stays blocked while any trip is open or any movement is neither delivered nor cancelled (`src/server/projects/closeout-checks.ts`).

## Bills

Finance (`finance.create`) drafts the carrier's bill from the movement page once it is booked and not yet billed: one line on the movement's budget line, drawing down its commitment, on account 5050 (Logistics and freight) with no GST rate, which Finance sets from the carrier's invoice (`src/server/logistics/billing.ts`). The button shows only when the carrier is a vendor on file; add a named carrier as a vendor first.

## Money

Costs are shown to people who see the project's costs or plan logistics; others see dashes. Money is integer minor units in the project's currency.

## Audit

`shipment.planned`, `.updated`, `.booked`, `.dispatched`, `.noted`, `.cost_changed`, `.delivered` and `.cancelled`, with the movement as the target, plus `vendor_bill.drafted` when a bill is drafted from it.
