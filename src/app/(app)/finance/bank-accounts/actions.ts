"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, formValues, toFormState, type FormState } from "@/server/http/action-result";
import {
  createBankAccount,
  updateBankAccount,
  type BankAccountInput,
} from "@/server/finance/bank-accounts";

const fields = (v: Record<string, string>): BankAccountInput => ({
  bankName: v.bankName ?? "",
  branch: v.branch,
  accountName: v.accountName ?? "",
  accountNumber: v.accountNumber ?? "",
  ifsc: v.ifsc,
  swift: v.swift,
  iban: v.iban,
  currency: v.currency ?? "",
  showOnInvoices: v.showOnInvoices ?? "",
});

export async function createBankAccountAction(
  legalEntityId: string,
  _: FormState,
  formData: FormData,
) {
  const state = await attempt(
    formData,
    async (v) => createBankAccount(await requireActor(), legalEntityId, fields(v)),
    "Bank account added",
  );
  if (state.status === "success") refresh();
  return state;
}

export async function updateBankAccountAction(id: string, _: FormState, formData: FormData) {
  const values = formValues(formData);
  try {
    await updateBankAccount(await requireActor(), id, fields(values));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/finance/bank-accounts/${id}`);
}
