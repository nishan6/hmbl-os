import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import {
  equipmentFormOptions,
  getItem,
  CONDITIONS,
  EQUIPMENT_OWNERSHIP,
  EQUIPMENT_TRACKING,
} from "@/server/equipment/inventory";
import { MAINTENANCE_KINDS } from "@/server/equipment/maintenance";
import { itemBookings } from "@/server/equipment/bookings";
import { AppError } from "@/lib/errors";
import { inServiceQuantity, inspectionState } from "@/lib/equipment";
import { formatDate, formatMoney } from "@/lib/format";
import { minorToInput } from "@/lib/money";
import { ActionButton } from "@/components/ui/action-button";
import { DetailList, PageHeader, Panel, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  adjustStockAction,
  archiveItemAction,
  createAssetAction,
  openStockJobAction,
  transferStockAction,
  updateItemAction,
} from "../actions";
import { ASSET_STATUS } from "../_components/equipment-tabs";
import { JobList } from "../_components/job-list";
import {
  AdjustStockForm,
  AssetForm,
  ItemForm,
  JobForm,
  TransferStockForm,
} from "../equipment-forms";

export const metadata = { title: "Equipment item" };

const date = (d: Date) => formatDate(d, "UTC");
const today = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
const MOVEMENTS = {
  ADDED: "Added",
  REMOVED: "Removed",
  TRANSFERRED: "Moved",
  OUT_OF_SERVICE: "Out of service",
  RETURNED_TO_SERVICE: "Back in service",
  DISPATCHED: "Out to a project",
  RETURNED: "Back from a project",
} as const;

export default async function ItemPage({ params }: PageProps<"/equipment/[id]">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const item = await getItem(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const rights = {
    create: can(actor, "equipment.create"),
    edit: can(actor, "equipment.edit"),
    approve: can(actor, "equipment.approve"),
    archive: can(actor, "equipment.archive"),
  };
  const [options, bookings] = await Promise.all([
    equipmentFormOptions(actor),
    itemBookings(actor, id),
  ]);
  const locations = options.locations.map((l) => ({ id: l.id, label: `${l.code} · ${l.name}` }));
  const vendors = options.vendors.map((v) => ({ id: v.id, label: v.name }));
  const archived = item.status === "ARCHIVED";
  const serialised = item.tracking === "SERIALISED";
  const money = (v: bigint | null) => (v === null ? "—" : formatMoney(v, item.currency));
  const input = (v: bigint | null) => (v === null ? "" : minorToInput(v, item.currency));
  const now = today();

  return (
    <>
      <PageHeader
        title={item.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="tabular">{item.sku}</span> · {item.category.name} ·{" "}
            {EQUIPMENT_TRACKING[item.tracking]}
            <StatusBadge status={archived ? "archived" : "active"} />
            {item.isDemo ? <Tag tone="warning">Demo</Tag> : null}
          </span>
        }
        breadcrumbs={[{ label: "Equipment", href: "/equipment" }, { label: item.name }]}
        actions={
          rights.archive ? (
            <ActionButton
              action={archiveItemAction.bind(null, id)}
              fields={{ archived: archived ? "false" : "true" }}
              size="md"
              confirm={archived ? undefined : "Archive this item? Its history stays."}
            >
              {archived ? "Restore" : "Archive"}
            </ActionButton>
          ) : null
        }
      />

      <Section title="Details">
        {rights.edit ? (
          <Panel>
            <ItemForm
              action={updateItemAction.bind(null, id)}
              defaults={{
                sku: item.sku,
                name: item.name,
                categoryId: item.categoryId,
                tracking: item.tracking,
                manufacturer: item.manufacturer ?? "",
                model: item.model ?? "",
                description: item.description ?? "",
                currency: item.currency,
                rentalDayRate: input(item.rentalDayRateMinor),
                internalDayCost: input(item.internalDayCostMinor),
                replacementValue: input(item.replacementValueMinor),
                notes: item.notes ?? "",
              }}
              categories={options.categories.map((c) => ({ id: c.id, label: c.name }))}
              tracking={EQUIPMENT_TRACKING}
              trackingLocked={item.assets.length > 0 || item.stock.length > 0}
              submitLabel="Save changes"
            />
          </Panel>
        ) : (
          <DetailList
            items={[
              {
                label: "Make and model",
                value: [item.manufacturer, item.model].filter(Boolean).join(" ") || "—",
              },
              { label: "Rental per day", value: money(item.rentalDayRateMinor) },
              { label: "Internal cost per day", value: money(item.internalDayCostMinor) },
              { label: "Replacement value", value: money(item.replacementValueMinor) },
              { label: "Description", value: item.description ?? "—" },
            ]}
          />
        )}
      </Section>

      {serialised ? (
        <Section title="Assets" description="Each unit, where it is and whether it can go out.">
          {item.assets.length ? (
            <Table dense>
              <THead>
                <tr>
                  <TH>Asset tag</TH>
                  <TH>Serial</TH>
                  <TH>Kept at</TH>
                  <TH>Condition</TH>
                  <TH>Inspection due</TH>
                  <TH>Status</TH>
                </tr>
              </THead>
              <TBody>
                {item.assets.map((a) => {
                  const inspection = inspectionState(a.nextInspectionDue, now);
                  return (
                    <TR key={a.id}>
                      <TD className="tabular">
                        <Link
                          href={`/equipment/assets/${a.id}`}
                          className="text-accent hover:underline"
                        >
                          {a.assetTag}
                        </Link>
                      </TD>
                      <TD className="tabular text-secondary">{a.serialNumber ?? "—"}</TD>
                      <TD className="text-secondary">{a.location?.code ?? "—"}</TD>
                      <TD>{CONDITIONS[a.condition]}</TD>
                      <TD className="tabular whitespace-nowrap">
                        {a.nextInspectionDue ? date(a.nextInspectionDue) : "—"}{" "}
                        {inspection === "overdue" ? (
                          <StatusBadge status="overdue" className="ml-1" />
                        ) : inspection === "due" ? (
                          <StatusBadge status="due" className="ml-1" />
                        ) : null}
                      </TD>
                      <TD>
                        <StatusBadge status={ASSET_STATUS[a.state]} />
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          ) : (
            <p className="text-secondary text-sm">No assets yet.</p>
          )}
          {rights.create && !archived ? (
            <Panel className="mt-4">
              <h3 className="text-text mb-3 text-sm font-semibold">Add an asset</h3>
              <AssetForm
                action={createAssetAction.bind(null, id)}
                defaults={{ ownership: "OWNED", purchaseCurrency: item.currency }}
                locations={locations}
                entities={options.entities.map((e) => ({
                  id: e.id,
                  label: `${e.code} · ${e.legalName}`,
                }))}
                vendors={vendors}
                ownership={EQUIPMENT_OWNERSHIP}
                submitLabel="Add asset"
              />
            </Panel>
          ) : null}
        </Section>
      ) : (
        <Section
          title="Stock"
          description="How many each location holds. Out-of-service stock can't go out."
        >
          {item.stock.length ? (
            <Table dense>
              <THead>
                <tr>
                  <TH>Location</TH>
                  <TH align="right">Held</TH>
                  <TH align="right">Out of service</TH>
                  <TH align="right">Can go out</TH>
                </tr>
              </THead>
              <TBody>
                {item.stock.map((s) => (
                  <TR key={s.id}>
                    <TD>
                      <span className="tabular">{s.location.code}</span>{" "}
                      <span className="text-secondary">{s.location.name}</span>
                    </TD>
                    <TD align="right">{s.quantity}</TD>
                    <TD align="right">{s.outOfServiceQuantity}</TD>
                    <TD align="right">{inServiceQuantity(s)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="text-secondary text-sm">No stock recorded yet.</p>
          )}
          {rights.edit && !archived ? (
            <div className="mt-4 grid gap-4">
              <Panel>
                <h3 className="text-text mb-3 text-sm font-semibold">Add or remove stock</h3>
                <AdjustStockForm action={adjustStockAction.bind(null, id)} locations={locations} />
              </Panel>
              {item.stock.length ? (
                <Panel>
                  <h3 className="text-text mb-3 text-sm font-semibold">Move stock</h3>
                  <TransferStockForm
                    action={transferStockAction.bind(null, id)}
                    locations={locations}
                  />
                </Panel>
              ) : null}
            </div>
          ) : null}
          {item.stockMovements.length ? (
            <details className="mt-4">
              <summary className="text-accent cursor-pointer text-sm">Stock history</summary>
              <Table dense>
                <THead>
                  <tr>
                    <TH>When</TH>
                    <TH>What</TH>
                    <TH>Location</TH>
                    <TH align="right">Held</TH>
                    <TH align="right">Out of service</TH>
                    <TH>Reason</TH>
                  </tr>
                </THead>
                <TBody>
                  {item.stockMovements.map((m) => (
                    <TR key={m.id}>
                      <TD className="tabular whitespace-nowrap">{date(m.createdAt)}</TD>
                      <TD>{MOVEMENTS[m.kind]}</TD>
                      <TD className="tabular">{m.location.code}</TD>
                      <TD align="right">{m.quantityChange ? signed(m.quantityChange) : "—"}</TD>
                      <TD align="right">
                        {m.outOfServiceChange ? signed(m.outOfServiceChange) : "—"}
                      </TD>
                      <TD className="text-secondary">{m.reason}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </details>
          ) : null}
        </Section>
      )}

      <Section title="Bookings" description="Current and upcoming reservations on projects.">
        {bookings.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Project</TH>
                <TH>Dates</TH>
                <TH align="right">Booked</TH>
                <TH align="right">Out</TH>
              </tr>
            </THead>
            <TBody>
              {bookings.map((b) => (
                <TR key={b.id}>
                  <TD>
                    <Link
                      href={`/projects/${b.project.id}/resources/equipment/${b.id}`}
                      className="text-accent hover:underline"
                    >
                      <span className="tabular">{b.project.number}</span> {b.project.name}
                    </Link>
                  </TD>
                  <TD className="tabular whitespace-nowrap">
                    {date(b.startDate)} – {date(b.endDate)}
                  </TD>
                  <TD align="right">{b.quantity}</TD>
                  <TD align="right">
                    {b.dispatchedQuantity - b.returnedQuantity - b.damagedQuantity - b.lostQuantity}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-secondary text-sm">Nothing booked.</p>
        )}
      </Section>

      <Section
        title="Maintenance"
        description={
          serialised
            ? "Open jobs on this item's assets. Open a job from the asset."
            : "Open jobs, and stock waiting to return to service."
        }
      >
        <JobList
          jobs={item.maintenance}
          rights={rights}
          vendors={vendors}
          currency={item.currency}
        />
        {!serialised && rights.edit && item.stock.length ? (
          <Panel className="mt-4">
            <h3 className="text-text mb-3 text-sm font-semibold">Report a fault or open a job</h3>
            <JobForm
              action={openStockJobAction.bind(null, id)}
              kinds={MAINTENANCE_KINDS}
              locations={item.stock.map((s) => ({
                id: s.location.id,
                label: `${s.location.code} · ${s.location.name}`,
              }))}
            />
          </Panel>
        ) : null}
      </Section>

      {item.kitComponents.length ? (
        <Section title="In kits">
          <ul className="text-sm">
            {item.kitComponents.map((c) => (
              <li key={c.id}>
                <Link href={`/equipment/kits/${c.kit.id}`} className="text-accent hover:underline">
                  {c.kit.name}
                </Link>{" "}
                <span className="text-secondary tabular">× {c.quantity}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}

function signed(n: number) {
  return n > 0 ? `+${n}` : `${n}`;
}
