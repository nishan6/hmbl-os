"use server";

import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, type FormState } from "@/server/http/action-result";
import { updateExpenseCategory } from "@/server/expenses/categories";
import { createInvoiceService, updateInvoiceService } from "@/server/finance/invoice-services";
import { updateFinanceSettings } from "@/server/finance/settings";

export async function updateFinanceSettingsAction(
  legalEntityId: string,
  _: FormState,
  formData: FormData,
) {
  const state = await attempt(
    formData,
    async (v) =>
      updateFinanceSettings(await requireActor(), legalEntityId, {
        revenueRecognition: (v.revenueRecognition ?? "") as "ON_INVOICE",
      }),
    "Saved",
  );
  if (state.status === "success") refresh();
  return state;
}

export async function updateExpenseCategoryAction(id: string, _: FormState, formData: FormData) {
  const state = await attempt(
    formData,
    async (v) =>
      updateExpenseCategory(await requireActor(), id, {
        name: v.name ?? "",
        accountCode: v.accountCode ?? "",
        limit: v.limit,
        receiptRequired: v.receiptRequired,
        archived: v.archived,
      }),
    "Saved",
  );
  if (state.status === "success") refresh();
  return state;
}

export async function createInvoiceServiceAction(
  legalEntityId: string,
  _: FormState,
  formData: FormData,
) {
  const state = await attempt(
    formData,
    async (v) =>
      createInvoiceService(await requireActor(), legalEntityId, {
        code: v.code ?? "",
        name: v.name ?? "",
      }),
    "Added",
  );
  if (state.status === "success") refresh();
  return state;
}

export async function updateInvoiceServiceAction(id: string, _: FormState, formData: FormData) {
  const state = await attempt(
    formData,
    async (v) =>
      updateInvoiceService(await requireActor(), id, { name: v.name ?? "", archived: v.archived }),
    "Saved",
  );
  if (state.status === "success") refresh();
  return state;
}
