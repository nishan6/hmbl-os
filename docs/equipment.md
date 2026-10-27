# Equipment

Equipment covers what HMBL owns or leases: fixtures, audio, video, staging, power and stock (spec §13). Like crew, it is group-wide. Each asset can record which company owns it. Code: `src/server/equipment/` and `src/lib/equipment.ts`. Screens: **Equipment** in the sidebar.

This page covers the inventory, maintenance, and booking equipment onto projects with dispatch and return. Rentals from vendors are bought through purchase orders ([procurement.md](procurement.md)).

## Categories

A category, such as Lighting or Power and cable, groups items. It can set:

- how often its items are inspected, in days;
- what an inspection checks, as a checklist.

Managing categories needs `equipment.configure`.

## Items

An item is one kind of equipment, such as "Robe MegaPointe" or "16A cable 10 m". It has a unique SKU, a category, a make and model, and is tracked in one of two ways:

- **One asset at a time** (serialised): each unit is an asset with its own tag.
- **By quantity**: counted as stock at each location.

The tracking is fixed once the item has assets or stock.

An item can also hold three amounts per unit, before tax, in one currency:

- the **rental per day** HMBL charges;
- the **internal cost per day**, for comparison only. It is never posted to a budget or the ledger (see [decisions.md](decisions.md));
- the **replacement value**.

An item can only be archived once it has no assets in use and no stock.

## Assets

An asset is one serialised unit. It records:

- a unique **asset tag**, and a serial number that is unique within its item;
- whether it is **owned or leased**, and which company owns it;
- where it is **kept**;
- its **condition**: good, fair or damaged;
- its **purchase**: date, vendor, reference and cost (with currency);
- its **warranty** date;
- its **inspection** dates.

Changing where an asset is kept is audited as a move.

An asset's state decides whether it can go out:

| State          | Meaning                                                             |
| -------------- | ------------------------------------------------------------------- |
| Available      | Can be booked                                                       |
| Out of service | Held back by a fault, a repair or a failed inspection               |
| Lost           | Written off as lost; marking it found brings it back out of service |
| Retired        | Written off for good                                                |

Marking an asset lost, found or retired needs `equipment.archive` and a reason.

## Stock

A quantity item has a stock count per location, and a count of how much of it is out of service. Only stock in service can be removed or moved. Every change is kept as an append-only stock movement with a reason:

- **added** (bought, or found on a count);
- **removed** (sold, or scrapped);
- **moved** between locations;
- taken **out of service** and **returned to service**.

Database checks keep both counts at zero or more, and the out-of-service count within what is held.

## Kits

A kit bundles items that go out together, such as a wireless mic kit, with a quantity of each. Each item appears once in a kit. When a kit's contents change, the change is audited as a before and after.

## Maintenance

A **job** is one of four kinds:

- scheduled maintenance;
- a fault;
- a repair;
- an inspection.

A job is on one asset, or on a quantity of a stock item at one location. It records:

- what it is about, and details;
- **planned downtime**: days the equipment can't be booked;
- when it is done: what was found or done, its cost, and the vendor who did it.

Opening a job can **take the equipment out of service** at once. This is the default for faults and repairs. An inspection copies its category's checklist. When the inspection is marked done, each check is recorded as passed or failed. If any check fails, the equipment is taken out of service.

Completing an inspection sets the asset's last inspection date. The next one falls due after the category's interval. A new asset in a category with an inspection schedule is due its first inspection straight away.

### Return to service

Finishing a job, or a booking ending, never makes equipment available by itself (spec §13). Someone with `equipment.approve` (Owner and Warehouse) returns it to service. For an asset, they also confirm its condition as good or fair. The return is refused while:

- a job that took it out of service is still open;
- its most recent inspection failed (a new inspection has to pass);
- its inspection is overdue.

Stock held out of service comes back one finished job at a time. The approver confirms that the stock is fit to go out, even after a failed inspection. Stock that can't be repaired is written off from the job instead (`equipment.archive`).

A cancelled job still holds what it took out of service until that equipment is returned.

## Bookings

A booking reserves a quantity of one item for a project over a run of days, usually against one of the project's equipment needs (see [resources.md](resources.md)). A kit is booked as one booking per item in it, each for the kit's quantity times the number of kits. Whoever runs the project (`projects.edit`) or keeps equipment (`equipment.edit`) in its entity can reserve, change and end bookings.

**Availability.** Reserving checks the busiest day in the booking's range. What can be promised is:

- for serialised items, every **available** asset;
- for stock, everything **in service** in a store, plus what is out on bookings and coming back.

Each day's demand is every other live booking still holding equipment (what isn't back yet), plus **planned downtime** on maintenance jobs. Reserving more than is free is a **shortfall**. It needs `equipment.approve` and a reason, usually renting the rest in. The reason and the shortfall are kept on the booking. Items are locked while they are checked, so two reservations can't both take the last unit.

**Named assets.** Before serialised equipment goes out, the warehouse names the assets on the booking. A database exclusion constraint (`btree_gist`) stops an asset being held by two bookings on any shared day. An asset that is out of service can't be named.

**Dispatch.** Checking out needs `equipment.edit`:

- for assets, the named ones going out. An asset out of service or overdue an inspection can't go out;
- for stock, a quantity from one store, which leaves that store's count.

**Check-in.** Each asset comes back good, fair, damaged or lost. Stock comes back as a count of good, damaged and lost, to a store:

- good equipment is available again at once;
- damaged equipment comes back **out of service**, with a fault job opened for it. It goes out again only once it is returned to service (see above);
- lost assets are marked lost, and lost stock is not added back.

A booking with everything back is closed. A booking can be extended while out, but its first day can't move once anything has gone out. With nothing out, it can be cancelled (if nothing ever went out) or closed, which releases the rest.

**Counts.** A booking keeps its quantity, and how many were dispatched, returned, damaged and lost. Database checks keep what is back within what went out, and what went out within the quantity. Each dispatch and check-in is kept as a movement.

**Utilisation.** **Equipment › Utilisation** shows, per item over a period, unit-days on bookings (cancelled ones left out) against unit-days held. Held is what is held today.

Owned equipment's internal cost is not posted to the project (see [decisions.md](decisions.md)).

## Permissions

| Action                                                               | Needs                 |
| -------------------------------------------------------------------- | --------------------- |
| See equipment                                                        | `equipment.view`      |
| Add items and assets                                                 | `equipment.create`    |
| Edit items, assets, stock and kits; open and close jobs              | `equipment.edit`      |
| Return equipment to service                                          | `equipment.approve`   |
| Archive items and kits; lose, find or retire assets; write off stock | `equipment.archive`   |
| Manage categories and checklists                                     | `equipment.configure` |

Project managers can view, add and edit equipment but can't return it to service. The **Warehouse** default role holds every equipment permission.

Every change is audited:

- items: `equipment_item.created`, `.updated`, `.archived`, `.restored`;
- assets: `equipment_asset.created`, `.updated`, `.moved`, `.lost`, `.found`, `.retired`, `.returned_to_service`;
- stock: `equipment_stock.added`, `.removed`, `.transferred`, `.returned_to_service`, `.written_off`;
- jobs: `equipment_maintenance.opened`, `.completed`, `.cancelled`;
- categories: `equipment_category.*`;
- kits: `equipment_kit.*`;
- bookings, against the project: `equipment_booking.reserved`, `.changed`, `.assets_allocated`, `.asset_released`, `.dispatched`, `.returned`, `.closed`, `.cancelled`.
