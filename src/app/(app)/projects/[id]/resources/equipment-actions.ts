"use server";

import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, type FormState } from "@/server/http/action-result";
import {
  allocateAssets,
  changeBooking,
  dispatchEquipment,
  endBooking,
  releaseAllocation,
  reserveEquipment,
  returnEquipment,
} from "@/server/equipment/bookings";

async function run(
  formData: FormData,
  fn: (values: Record<string, string>) => Promise<unknown>,
  message?: string,
) {
  const state = await attempt(formData, fn, message);
  if (state.status === "success") refresh();
  return state;
}

/** Checkboxes and per-row fields arrive as `<prefix><id>`. */
const prefixed = (v: Record<string, string>, prefix: string) =>
  Object.entries(v)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, value]) => ({ id: k.slice(prefix.length), value }));

export async function reserveEquipmentAction(projectId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) => {
      // One select names an item ("item:<id>") or a kit ("kit:<id>").
      const [kind, id] = (v.equipment ?? "").split(":");
      return reserveEquipment(await requireActor(), projectId, {
        requirementId: v.requirementId,
        itemId: kind === "item" ? id : null,
        kitId: kind === "kit" ? id : null,
        quantity: v.quantity,
        startDate: v.startDate,
        endDate: v.endDate,
        notes: v.notes,
        overrideReason: v.overrideReason,
      });
    },
    "Reserved",
  );
}

export async function changeBookingAction(bookingId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) =>
      changeBooking(await requireActor(), bookingId, {
        quantity: v.quantity ?? "",
        startDate: v.startDate,
        endDate: v.endDate,
        notes: v.notes,
        overrideReason: v.overrideReason,
      }),
    "Saved",
  );
}

export async function endBookingAction(bookingId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) => endBooking(await requireActor(), bookingId, { reason: v.reason }),
    "Booking ended",
  );
}

export async function allocateAction(bookingId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) =>
      allocateAssets(await requireActor(), bookingId, {
        assetIds: prefixed(v, "asset:").map((x) => x.id),
      }),
    "Assets named",
  );
}

export async function releaseAllocationAction(_: FormState, formData: FormData) {
  return run(formData, async (v) => releaseAllocation(await requireActor(), v.allocationId ?? ""));
}

export async function dispatchAction(bookingId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) =>
      dispatchEquipment(await requireActor(), bookingId, {
        allocationIds: prefixed(v, "allocation:").map((x) => x.id),
        locationId: v.locationId,
        quantity: v.quantity,
        notes: v.notes,
      }),
    "Dispatched",
  );
}

export async function returnAction(bookingId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) =>
      returnEquipment(await requireActor(), bookingId, {
        assets: prefixed(v, "outcome:")
          .filter((x) => x.value)
          .map((x) => ({
            allocationId: x.id,
            outcome: x.value as "GOOD" | "FAIR" | "DAMAGED" | "LOST",
          })),
        locationId: v.locationId,
        good: v.good,
        damaged: v.damaged,
        lost: v.lost,
        notes: v.notes,
      }),
    "Checked in",
  );
}
