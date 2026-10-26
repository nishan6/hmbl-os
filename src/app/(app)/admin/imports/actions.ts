"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/auth/session";
import { attempt, formValues, toFormState, type FormState } from "@/server/http/action-result";
import {
  commitImport,
  correctRow,
  decideAll,
  decideRow,
  discardImport,
  dryRun,
  saveMapping,
  stageImport,
} from "@/server/imports/batches";

type Decision = "CREATE" | "UPDATE" | "SKIP";

export async function stageImportAction(_: FormState, formData: FormData) {
  const values = formValues(formData);
  let id: string;
  try {
    ({ id } = await stageImport(await requireActor(), {
      kind: (values.kind ?? "") as "CLIENTS",
      fileName: values.fileName ?? "",
      text: values.text ?? "",
    }));
  } catch (error) {
    return toFormState(error, values);
  }
  redirect(`/admin/imports/${id}`);
}

/**
 * The mapping form sends `source.<field>` as "" (not imported), a column
 * number, or "fixed" with the value in `fixed.<field>`.
 */
function mappingFrom(values: Record<string, string>) {
  const mapping: Record<string, unknown> = {};
  for (const [name, source] of Object.entries(values)) {
    if (!name.startsWith("source.") || source === "") continue;
    const key = name.slice("source.".length);
    mapping[key] = source === "fixed" ? { value: values[`fixed.${key}`] ?? "" } : Number(source);
  }
  return mapping;
}

export async function saveMappingAction(id: string, _: FormState, formData: FormData) {
  const state = await attempt(
    formData,
    async (v) => saveMapping(await requireActor(), id, mappingFrom(v)),
    "Mapping saved and every row checked again",
  );
  if (state.status === "success") refresh();
  return state;
}

export async function correctRowAction(rowId: string, _: FormState, formData: FormData) {
  const state = await attempt(
    formData,
    async (v) => correctRow(await requireActor(), rowId, v),
    "Correction saved",
  );
  if (state.status === "success") refresh();
  return state;
}

export async function decideRowAction(rowId: string, _: FormState, formData: FormData) {
  const state = await attempt(formData, async (v) =>
    decideRow(await requireActor(), rowId, { decision: (v.decision ?? "") as Decision }),
  );
  if (state.status === "success") refresh();
  return state;
}

export async function decideAllAction(id: string, _: FormState, formData: FormData) {
  const state = await attempt(formData, async (v) =>
    decideAll(await requireActor(), id, { decision: (v.decision ?? "") as Decision }),
  );
  if (state.status === "success") refresh();
  return state;
}

export async function dryRunAction(
  id: string,
  _: FormState,
  formData: FormData,
): Promise<FormState> {
  const values = formValues(formData);
  try {
    const { plan, problems, ready } = await dryRun(await requireActor(), id);
    refresh();
    const outline =
      `${plan.create} to create, ${plan.update} to update, ${plan.skip} to skip, ` +
      `${plan.rejected} with problems that won't be imported`;
    if (!ready) return { status: "error", message: `${problems.join("; ")}. ${outline}.`, values };
    return { status: "success", message: `Ready to commit: ${outline}.`, savedAt: Date.now() };
  } catch (error) {
    return toFormState(error, values);
  }
}

export async function commitImportAction(id: string, _: FormState, formData: FormData) {
  const state = await attempt(formData, async () => commitImport(await requireActor(), id));
  if (state.status === "success") refresh();
  return state;
}

export async function discardImportAction(id: string, _: FormState, formData: FormData) {
  const state = await attempt(formData, async () => discardImport(await requireActor(), id));
  if (state.status === "success") refresh();
  return state;
}
