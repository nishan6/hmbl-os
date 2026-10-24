import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import {
  equipmentFormOptions,
  getAsset,
  CONDITIONS,
  EQUIPMENT_OWNERSHIP,
} from "@/server/equipment/inventory";
import { assetServiceBlockers, MAINTENANCE_KINDS } from "@/server/equipment/maintenance";
import { AppError } from "@/lib/errors";
import { inspectionState } from "@/lib/equipment";
import { formatDate, formatMoney } from "@/lib/format";
import { minorToInput } from "@/lib/money";
import { Alert, DetailList, PageHeader, Panel, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import {
  assetStateAction,
  openAssetJobAction,
  returnAssetAction,
  updateAssetAction,
} from "../../actions";
import { ASSET_STATUS } from "../../_components/equipment-tabs";
import { JobList } from "../../_components/job-list";
import { AssetForm, JobForm, ReasonForm, ReturnToServiceForm } from "../../equipment-forms";

export const metadata = { title: "Equipment asset" };

const date = (d: Date | null) => (d ? formatDate(d, "UTC") : "—");
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const today = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

export default async function AssetPage({ params }: PageProps<"/equipment/assets/[id]">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const asset = await getAsset(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const rights = {
    edit: can(actor, "equipment.edit"),
    approve: can(actor, "equipment.approve"),
    archive: can(actor, "equipment.archive"),
  };
  const options = await equipmentFormOptions(actor);
  const vendors = options.vendors.map((v) => ({ id: v.id, label: v.name }));
  const writtenOff = asset.state === "LOST" || asset.state === "RETIRED";
  const blockers = asset.state === "OUT_OF_SERVICE" ? await assetServiceBlockers(id) : [];
  const inspection = inspectionState(asset.nextInspectionDue, today());
  const title = `${asset.assetTag} · ${asset.item.name}`;

  return (
    <>
      <PageHeader
        title={title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {asset.serialNumber ? (
              <span className="tabular">Serial {asset.serialNumber}</span>
            ) : null}
            <StatusBadge status={ASSET_STATUS[asset.state]} />
            <span>Condition {CONDITIONS[asset.condition].toLowerCase()}</span>
            {inspection === "overdue" ? <StatusBadge status="overdue" /> : null}
            {asset.isDemo ? <Tag tone="warning">Demo</Tag> : null}
          </span>
        }
        breadcrumbs={[
          { label: "Equipment", href: "/equipment" },
          { label: asset.item.name, href: `/equipment/${asset.itemId}` },
          { label: asset.assetTag },
        ]}
      />

      {asset.state === "OUT_OF_SERVICE" ? (
        <Section
          title="Return to service"
          description="Out-of-service equipment goes out again only once someone with equipment approval has checked it."
        >
          {asset.stateReason ? (
            <p className="text-secondary mb-2 text-sm">Out of service: {asset.stateReason}</p>
          ) : null}
          {blockers.filter((b) => b !== "Its condition is still damaged").length ? (
            <Alert tone="warning" title="It can't go back yet">
              <ul className="list-disc pl-4">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </Alert>
          ) : rights.approve ? (
            <Panel>
              <ReturnToServiceForm action={returnAssetAction.bind(null, id)} />
            </Panel>
          ) : (
            <p className="text-secondary text-sm">
              Ready for a warehouse lead or the Director to return it to service.
            </p>
          )}
        </Section>
      ) : null}

      <Section title="Details">
        {rights.edit && !writtenOff ? (
          <Panel>
            <AssetForm
              action={updateAssetAction.bind(null, id)}
              defaults={{
                assetTag: asset.assetTag,
                serialNumber: asset.serialNumber ?? "",
                ownership: asset.ownership,
                legalEntityId: asset.legalEntityId ?? "",
                locationId: asset.locationId ?? "",
                purchasedOn: iso(asset.purchasedOn),
                purchaseCost:
                  asset.purchaseCostMinor !== null && asset.purchaseCurrency
                    ? minorToInput(asset.purchaseCostMinor, asset.purchaseCurrency)
                    : "",
                purchaseCurrency: asset.purchaseCurrency ?? asset.item.currency,
                purchasedFromId: asset.purchasedFromId ?? "",
                purchaseReference: asset.purchaseReference ?? "",
                warrantyUntil: iso(asset.warrantyUntil),
                notes: asset.notes ?? "",
              }}
              locations={options.locations.map((l) => ({
                id: l.id,
                label: `${l.code} · ${l.name}`,
              }))}
              entities={options.entities.map((e) => ({
                id: e.id,
                label: `${e.code} · ${e.legalName}`,
              }))}
              vendors={vendors}
              ownership={EQUIPMENT_OWNERSHIP}
              submitLabel="Save changes"
            />
          </Panel>
        ) : (
          <DetailList
            items={[
              {
                label: "Kept at",
                value: asset.location ? `${asset.location.code} · ${asset.location.name}` : "—",
              },
              { label: "Ownership", value: EQUIPMENT_OWNERSHIP[asset.ownership] },
              { label: "Owned by", value: asset.legalEntity?.legalName ?? "—" },
              {
                label: "Bought",
                value: `${date(asset.purchasedOn)}${asset.purchasedFrom ? ` from ${asset.purchasedFrom.name}` : ""}`,
              },
              {
                label: "Cost",
                value:
                  asset.purchaseCostMinor !== null && asset.purchaseCurrency
                    ? formatMoney(asset.purchaseCostMinor, asset.purchaseCurrency)
                    : "—",
              },
              { label: "Warranty until", value: date(asset.warrantyUntil) },
            ]}
          />
        )}
        <p className="text-secondary mt-3 text-sm">
          Last inspected <span className="tabular">{date(asset.lastInspectedOn)}</span>, next due{" "}
          <span className="tabular">{date(asset.nextInspectionDue)}</span>.
        </p>
      </Section>

      <Section title="Maintenance" description="Service history, faults, repairs and inspections.">
        <JobList
          jobs={asset.maintenance.map((m) => ({ ...m, asset: null }))}
          rights={{ ...rights, approve: false, archive: false }}
          vendors={vendors}
          currency={asset.item.currency}
        />
        {rights.edit && !writtenOff ? (
          <Panel className="mt-4">
            <h3 className="text-text mb-3 text-sm font-semibold">Report a fault or open a job</h3>
            <JobForm action={openAssetJobAction.bind(null, id)} kinds={MAINTENANCE_KINDS} />
          </Panel>
        ) : null}
      </Section>

      {rights.archive ? (
        <Section
          title="Write off"
          description="Lost or retired assets stay on record but never go out."
        >
          {asset.state === "RETIRED" ? (
            <p className="text-secondary text-sm">Retired: {asset.stateReason}</p>
          ) : (
            <Panel>
              <ReasonForm
                action={assetStateAction.bind(null, id)}
                label="What happened"
                submitLabel="Record"
                choices={
                  asset.state === "LOST"
                    ? [{ value: "FOUND", label: "It was found" }]
                    : [
                        { value: "LOST", label: "Mark lost" },
                        { value: "RETIRED", label: "Retire" },
                      ]
                }
              />
            </Panel>
          )}
        </Section>
      ) : null}
    </>
  );
}
