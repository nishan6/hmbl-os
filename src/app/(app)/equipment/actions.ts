"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, formValues, toFormState, type FormState } from "@/server/http/action-result";
import {
  adjustStock,
  createAsset,
  createItem,
  saveCategory,
  saveKit,
  setAssetState,
  setCategoryArchived,
  setItemArchived,
  setKitArchived,
  transferStock,
  updateAsset,
  updateItem,
  type AdjustInput,
  type AssetInput,
  type ItemInput,
} from "@/server/equipment/inventory";
import {
  cancelMaintenance,
  completeMaintenance,
  openMaintenance,
  returnAssetToService,
  returnStockToService,
  writeOffStock,
  type MaintenanceInput,
} from "@/server/equipment/maintenance";

async function run(
  formData: FormData,
  fn: (values: Record<string, string>) => Promise<unknown>,
  message?: string,
) {
  const state = await attempt(formData, fn, message);
  if (state.status === "success") refresh();
  return state;
}

const itemFields = (v: Record<string, string>): ItemInput => ({
  sku: v.sku ?? "",
  name: v.name ?? "",
  categoryId: v.categoryId ?? "",
  tracking: (v.tracking ?? "") as ItemInput["tracking"],
  manufacturer: v.manufacturer,
  model: v.model,
  description: v.description,
  currency: v.currency ?? "",
  rentalDayRate: v.rentalDayRate,
  internalDayCost: v.internalDayCost,
  replacementValue: v.replacementValue,
  notes: v.notes,
});

const assetFields = (v: Record<string, string>): AssetInput => ({
  assetTag: v.assetTag ?? "",
  serialNumber: v.serialNumber,
  ownership: (v.ownership ?? "") as AssetInput["ownership"],
  legalEntityId: v.legalEntityId,
  locationId: v.locationId,
  purchasedOn: v.purchasedOn,
  purchaseCost: v.purchaseCost,
  purchaseCurrency: v.purchaseCurrency,
  purchasedFromId: v.purchasedFromId,
  purchaseReference: v.purchaseReference,
  warrantyUntil: v.warrantyUntil,
  notes: v.notes,
});

const jobFields = (v: Record<string, string>): MaintenanceInput => ({
  kind: (v.kind ?? "") as MaintenanceInput["kind"],
  title: v.title ?? "",
  details: v.details,
  takesOutOfService: v.takesOutOfService,
  blockFrom: v.blockFrom,
  blockTo: v.blockTo,
  locationId: v.locationId,
  quantity: v.quantity,
});

// ─── Categories ──────────────────────────────────────────────────────────────

export async function saveCategoryAction(id: string | null, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) =>
      saveCategory(await requireActor(), id, {
        name: v.name ?? "",
        description: v.description,
        inspectionIntervalDays: v.inspectionIntervalDays,
        inspectionChecklist: v.inspectionChecklist,
      }),
    id ? "Saved" : "Category added",
  );
}

export async function archiveCategoryAction(_: FormState, formData: FormData) {
  return run(formData, async (v) =>
    setCategoryArchived(await requireActor(), v.categoryId ?? "", v.archived === "true"),
  );
}

// ─── Items and assets ────────────────────────────────────────────────────────

export async function createItemAction(_: FormState, formData: FormData) {
  const values = formValues(formData);
  let id: string;
  try {
    ({ id } = await createItem(await requireActor(), itemFields(values)));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/equipment/${id}`);
}

export async function updateItemAction(id: string, _: FormState, formData: FormData) {
  return run(formData, async (v) => updateItem(await requireActor(), id, itemFields(v)), "Saved");
}

export async function archiveItemAction(id: string, _: FormState, formData: FormData) {
  return run(formData, async (v) =>
    setItemArchived(await requireActor(), id, v.archived === "true"),
  );
}

export async function createAssetAction(itemId: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  let id: string;
  try {
    ({ id } = await createAsset(await requireActor(), itemId, assetFields(values)));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/equipment/assets/${id}`);
}

export async function updateAssetAction(id: string, _: FormState, formData: FormData) {
  return run(formData, async (v) => updateAsset(await requireActor(), id, assetFields(v)), "Saved");
}

export async function assetStateAction(id: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) => setAssetState(await requireActor(), id, { state: v.state, reason: v.reason }),
    "Recorded",
  );
}

export async function adjustStockAction(itemId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) =>
      adjustStock(await requireActor(), itemId, {
        locationId: v.locationId ?? "",
        direction: (v.direction ?? "") as AdjustInput["direction"],
        quantity: v.quantity ?? "",
        reason: v.reason ?? "",
      }),
    "Stock updated",
  );
}

export async function transferStockAction(itemId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) =>
      transferStock(await requireActor(), itemId, {
        fromLocationId: v.fromLocationId ?? "",
        toLocationId: v.toLocationId ?? "",
        quantity: v.quantity ?? "",
        reason: v.reason ?? "",
      }),
    "Moved",
  );
}

// ─── Maintenance ─────────────────────────────────────────────────────────────

export async function openAssetJobAction(assetId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) => openMaintenance(await requireActor(), { assetId }, jobFields(v)),
    "Job opened",
  );
}

export async function openStockJobAction(itemId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) => openMaintenance(await requireActor(), { itemId }, jobFields(v)),
    "Job opened",
  );
}

export async function completeJobAction(jobId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) =>
      completeMaintenance(await requireActor(), jobId, {
        outcome: v.outcome ?? "",
        cost: v.cost,
        currency: v.currency,
        vendorId: v.vendorId,
        condition: v.condition as "GOOD" | "FAIR" | "DAMAGED" | "",
        // Each passed check is sent as check:<label>.
        passedChecks: Object.keys(v)
          .filter((k) => k.startsWith("check:"))
          .map((k) => k.slice("check:".length)),
      }),
    "Job done",
  );
}

export async function cancelJobAction(jobId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) => cancelMaintenance(await requireActor(), jobId, { reason: v.reason }),
    "Job cancelled",
  );
}

export async function returnAssetAction(assetId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) =>
      returnAssetToService(await requireActor(), assetId, {
        condition: (v.condition ?? "") as "GOOD" | "FAIR",
        note: v.note,
      }),
    "Back in service",
  );
}

export async function returnStockAction(_: FormState, formData: FormData) {
  return run(formData, async (v) =>
    returnStockToService(await requireActor(), v.jobId ?? "", { note: v.note }),
  );
}

export async function writeOffStockAction(jobId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) => writeOffStock(await requireActor(), jobId, { reason: v.reason }),
    "Written off",
  );
}

// ─── Kits ────────────────────────────────────────────────────────────────────

export async function saveKitAction(id: string | null, _: FormState, formData: FormData) {
  const values = formValues(formData);
  let kitId: string;
  try {
    // Rows arrive as itemId.N and quantity.N; blank rows are skipped.
    const components = Object.keys(values)
      .filter((k) => k.startsWith("itemId.") && values[k])
      .map((k) => ({ itemId: values[k]!, quantity: values[`quantity.${k.slice(7)}`] ?? "" }));
    ({ id: kitId } = await saveKit(await requireActor(), id, {
      code: values.code ?? "",
      name: values.name ?? "",
      description: values.description,
      components,
    }));
  } catch (error) {
    return toFormState(error, values);
  }
  if (!id) redirect(`/equipment/kits/${kitId}`);
  refresh();
  return { status: "success", message: "Saved", savedAt: Date.now() } satisfies FormState;
}

export async function archiveKitAction(id: string, _: FormState, formData: FormData) {
  return run(formData, async (v) =>
    setKitArchived(await requireActor(), id, v.archived === "true"),
  );
}
