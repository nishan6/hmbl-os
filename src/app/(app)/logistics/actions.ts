"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { draftBillFromTrip } from "@/server/logistics/billing";
import { attempt, formValues, toFormState, type FormState } from "@/server/http/action-result";
import {
  addBooking,
  addTraveller,
  allocateRooms,
  approveTrip,
  cancelBooking,
  cancelTrip,
  changeBooking,
  completeTrip,
  confirmBooking,
  createTrip,
  rejectTrip,
  removeTraveller,
  submitTrip,
  updateHeldBooking,
  updateTraveller,
  updateTrip,
  type BookingInput,
  type TravellerInput,
} from "@/server/logistics/travel";

async function run(
  formData: FormData,
  fn: (values: Record<string, string>) => Promise<unknown>,
  message?: string,
) {
  const state = await attempt(formData, fn, message);
  if (state.status === "success") refresh();
  return state;
}

const tripFields = (v: Record<string, string>) => ({
  title: v.title ?? "",
  startDate: v.startDate,
  endDate: v.endDate,
  route: v.route,
  estimate: v.estimate,
  budgetLineId: v.budgetLineId,
  notes: v.notes,
});

export async function createTripAction(_: FormState, formData: FormData) {
  const values = formValues(formData);
  let id: string;
  try {
    ({ id } = await createTrip(await requireActor(), {
      projectId: values.projectId ?? "",
      ...tripFields(values),
    }));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/logistics/travel/${id}`);
}

export async function updateTripAction(id: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  try {
    await updateTrip(await requireActor(), id, tripFields(values));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/logistics/travel/${id}`);
}

const TRIP_COMMANDS = {
  submit: submitTrip,
  approve: approveTrip,
  complete: completeTrip,
} as const;

export async function tripCommandAction(id: string, _: FormState, formData: FormData) {
  return run(formData, async ({ command = "" }) => {
    const fn = TRIP_COMMANDS[command as keyof typeof TRIP_COMMANDS];
    if (!fn) throw new Error(`Unknown command ${command}`);
    return fn(await requireActor(), id);
  });
}

export async function rejectTripAction(id: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async ({ reason = "" }) => rejectTrip(await requireActor(), id, { reason }),
    "Sent back",
  );
}

export async function cancelTripAction(id: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async ({ reason = "" }) => cancelTrip(await requireActor(), id, { reason }),
    "Trip cancelled",
  );
}

const travellerFields = (v: Record<string, string>): TravellerInput => ({
  crewMemberId: v.crewMemberId,
  name: v.name,
  phone: v.phone,
  email: v.email,
  preferences: v.preferences,
  documentType: v.documentType as TravellerInput["documentType"],
  documentNumber: v.documentNumber,
  documentExpiry: v.documentExpiry,
  nationality: v.nationality,
  visaReference: v.visaReference,
});

export async function addTravellerAction(tripId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) => addTraveller(await requireActor(), tripId, travellerFields(v)),
    "Traveller added",
  );
}

export async function updateTravellerAction(
  tripId: string,
  travellerId: string,
  _: FormState,
  formData: FormData,
) {
  const values = formValues(formData);
  try {
    await updateTraveller(await requireActor(), travellerId, travellerFields(values));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/logistics/travel/${tripId}`);
}

export async function removeTravellerAction(_: FormState, formData: FormData) {
  return run(formData, async ({ travellerId = "" }) =>
    removeTraveller(await requireActor(), travellerId),
  );
}

function bookingFields(formData: FormData): BookingInput {
  const v = formValues(formData);
  return {
    kind: (v.kind ?? "") as BookingInput["kind"],
    vendorId: v.vendorId,
    provider: v.provider,
    reference: v.reference,
    serviceDetails: v.serviceDetails,
    fromPlace: v.fromPlace,
    toPlace: v.toPlace,
    departLocal: v.departLocal,
    departTimeZone: v.departTimeZone,
    arriveLocal: v.arriveLocal,
    arriveTimeZone: v.arriveTimeZone,
    checkIn: v.checkIn,
    checkOut: v.checkOut,
    rooms: v.rooms,
    address: v.address,
    driverName: v.driverName,
    driverPhone: v.driverPhone,
    cost: v.cost,
    travellerIds: formData.getAll("travellerIds").filter((x): x is string => typeof x === "string"),
    notes: v.notes,
  };
}

export async function addBookingAction(tripId: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  try {
    await addBooking(await requireActor(), tripId, bookingFields(formData));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/logistics/travel/${tripId}`);
}

export async function updateBookingAction(
  tripId: string,
  bookingId: string,
  _: FormState,
  formData: FormData,
) {
  const values = formValues(formData);
  try {
    await updateHeldBooking(await requireActor(), bookingId, bookingFields(formData));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/logistics/travel/${tripId}`);
}

export async function changeBookingAction(
  tripId: string,
  bookingId: string,
  _: FormState,
  formData: FormData,
) {
  const values = formValues(formData);
  try {
    await changeBooking(await requireActor(), bookingId, {
      ...bookingFields(formData),
      reason: values.reason ?? "",
      fee: values.fee,
    });
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/logistics/travel/${tripId}`);
}

export async function confirmBookingAction(_: FormState, formData: FormData) {
  return run(formData, async ({ bookingId = "" }) =>
    confirmBooking(await requireActor(), bookingId),
  );
}

export async function cancelBookingAction(bookingId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async ({ reason = "", fee }) => cancelBooking(await requireActor(), bookingId, { reason, fee }),
    "Booking cancelled",
  );
}

export async function allocateRoomsAction(bookingId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) =>
      allocateRooms(await requireActor(), bookingId, {
        rooms: Object.entries(v)
          .filter(([key]) => key.startsWith("room:"))
          .map(([key, room]) => ({ travellerId: key.slice(5), room })),
      }),
    "Rooms saved",
  );
}

export async function billTripAction(tripId: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  let id: string;
  try {
    ({ id } = await draftBillFromTrip(await requireActor(), tripId, values.vendorId ?? ""));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/finance/bills/${id}/edit`);
}
