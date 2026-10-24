"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import {
  addStatementLine,
  clearIntoOpening,
  completeReconciliation,
  deleteStatementLine,
  importStatement,
  matchStatementLine,
  postStatementLine,
  reopenReconciliation,
  unmatchStatementLine,
} from "@/server/finance/bank-reconciliation";
import { attempt, formValues, toFormState, type FormState } from "@/server/http/action-result";

const page = (id: string) => `/finance/bank-accounts/${id}/reconcile`;

export async function importStatementAction(
  bankAccountId: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const { text = "", ...v } = formValues(formData);
  let message = "";
  try {
    const done = await importStatement(await requireActor(), bankAccountId, {
      text,
      fileName: v.fileName,
      dateFormat: (v.dateFormat ?? "") as "DD/MM/YYYY",
      date: v.date,
      description: v.description,
      reference: v.reference,
      amount: v.amount,
      withdrawal: v.withdrawal,
      deposit: v.deposit,
      balance: v.balance,
      headerRow: v.headerRow,
      lastRow: v.lastRow,
    });
    message = `${done.lineCount} line${done.lineCount === 1 ? "" : "s"} imported${done.skippedCount ? `, ${done.skippedCount} already here` : ""}`;
  } catch (error) {
    // The file stays in the browser; don't send it back.
    return toFormState(error, v);
  }
  refresh();
  return { status: "success", message, savedAt: Date.now() };
}

export async function addStatementLineAction(
  bankAccountId: string,
  _: FormState,
  formData: FormData,
) {
  const state = await attempt(
    formData,
    async (v) =>
      addStatementLine(await requireActor(), bankAccountId, {
        date: v.date ?? "",
        description: v.description ?? "",
        reference: v.reference,
        amount: v.amount ?? "",
        direction: (v.direction ?? "") as "in",
      }),
    "Statement line added",
  );
  if (state.status === "success") refresh();
  return state;
}

export async function deleteStatementLineAction(_: FormState, formData: FormData) {
  const state = await attempt(formData, async (v) =>
    deleteStatementLine(await requireActor(), v.lineId ?? ""),
  );
  if (state.status === "success") refresh();
  return state;
}

export async function matchStatementLineAction(
  bankAccountId: string,
  lineId: string,
  _: FormState,
  formData: FormData,
) {
  const values = formValues(formData);
  try {
    await matchStatementLine(await requireActor(), lineId, {
      journalLineIds: formData.getAll("journalLineId").map(String),
    });
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(page(bankAccountId));
}

export async function unmatchStatementLineAction(_: FormState, formData: FormData) {
  const state = await attempt(formData, async (v) =>
    unmatchStatementLine(await requireActor(), v.lineId ?? ""),
  );
  if (state.status === "success") refresh();
  return state;
}

export async function clearIntoOpeningAction(_: FormState, formData: FormData) {
  const state = await attempt(formData, async (v) =>
    clearIntoOpening(
      await requireActor(),
      v.bankAccountId ?? "",
      v.journalLineId ?? "",
      v.cleared === "true",
    ),
  );
  if (state.status === "success") refresh();
  return state;
}

export async function postStatementLineAction(
  bankAccountId: string,
  lineId: string,
  _: FormState,
  formData: FormData,
) {
  const values = formValues(formData);
  try {
    await postStatementLine(await requireActor(), lineId, {
      accountId: values.accountId ?? "",
      narration: values.narration ?? "",
      fxRate: values.fxRate,
    });
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(page(bankAccountId));
}

export async function completeReconciliationAction(
  bankAccountId: string,
  _: FormState,
  formData: FormData,
) {
  const values = formValues(formData);
  try {
    await completeReconciliation(await requireActor(), bankAccountId, {
      date: values.date ?? "",
      balance: values.balance ?? "",
    });
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(page(bankAccountId));
}

export async function reopenReconciliationAction(
  reconciliationId: string,
  _: FormState,
  formData: FormData,
) {
  const state = await attempt(
    formData,
    async (v) => reopenReconciliation(await requireActor(), reconciliationId, { reason: v.reason }),
    "Reconciliation reopened",
  );
  if (state.status === "success") refresh();
  return state;
}
