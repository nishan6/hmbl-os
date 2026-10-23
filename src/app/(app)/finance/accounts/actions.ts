"use server";

import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, type FormState } from "@/server/http/action-result";
import {
  createAccount,
  setAccountArchived,
  setUpChartOfAccounts,
  updateAccount,
} from "@/server/finance/accounts";

const fields = (v: Record<string, string>) => ({
  code: v.code ?? "",
  name: v.name ?? "",
  subtype: (v.subtype ?? "") as "CASH",
  description: v.description,
});

async function run(
  formData: FormData,
  fn: (values: Record<string, string>) => Promise<unknown>,
  message?: string,
) {
  const state = await attempt(formData, fn, message);
  if (state.status === "success") refresh();
  return state;
}

export async function setUpChartAction(legalEntityId: string, _: FormState, formData: FormData) {
  return run(formData, async () => setUpChartOfAccounts(await requireActor(), legalEntityId));
}

export async function createAccountAction(legalEntityId: string, _: FormState, formData: FormData) {
  return run(
    formData,
    async (v) => createAccount(await requireActor(), legalEntityId, fields(v)),
    "Account added",
  );
}

export async function updateAccountAction(id: string, _: FormState, formData: FormData) {
  return run(formData, async (v) => updateAccount(await requireActor(), id, fields(v)), "Saved");
}

export async function archiveAccountAction(id: string, _: FormState, formData: FormData) {
  return run(formData, async ({ archived }) =>
    setAccountArchived(await requireActor(), id, archived === "true"),
  );
}
