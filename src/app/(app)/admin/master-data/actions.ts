"use server";

import { refresh } from "next/cache";
import { requireActor } from "@/server/auth/session";
import { attempt, type FormState } from "@/server/http/action-result";
import {
  createPaymentTerm,
  createTaxRate,
  createUnit,
  setDefaultPaymentTerm,
  setDefaultTaxRate,
  setPaymentTermArchived,
  setTaxRateArchived,
  setUnitArchived,
} from "@/server/master-data/service";
import { createStage, moveStage, setStageArchived } from "@/server/crm/pipeline";
import { updateCommercialSettings } from "@/server/commercial/settings";
import { createProjectType, setProjectTypeArchived } from "@/server/projects/types";
import { createCostCode, setCostCodeArchived } from "@/server/projects/cost-codes";

async function run(formData: FormData, fn: (values: Record<string, string>) => Promise<unknown>) {
  const state = await attempt(formData, async (values) => fn(values));
  if (state.status === "success") refresh();
  return state;
}

export async function createTaxRateAction(_: FormState, formData: FormData) {
  return run(formData, async (v) =>
    createTaxRate(await requireActor(), {
      countryCode: v.countryCode ?? "",
      code: v.code ?? "",
      name: v.name ?? "",
      treatment: (v.treatment ?? "STANDARD") as "STANDARD",
      rate: v.rate ?? "",
    }),
  );
}

export async function taxRateCommandAction(_: FormState, formData: FormData) {
  return run(formData, async ({ id = "", command }) => {
    const actor = await requireActor();
    if (command === "default") return setDefaultTaxRate(actor, id);
    return setTaxRateArchived(actor, id, command === "archive");
  });
}

/** Instalments arrive as instalments.0.label, instalments.0.percent and so on. */
function instalmentsFrom(values: Record<string, string>) {
  const rows: Record<string, string>[] = [];
  for (const [key, value] of Object.entries(values)) {
    const match = /^instalments\.(\d+)\.(\w+)$/.exec(key);
    if (!match) continue;
    const index = Number(match[1]);
    rows[index] = { ...rows[index], [match[2]!]: value };
  }
  return rows.filter(Boolean).map((r) => ({
    label: r.label ?? "",
    percent: r.percent ?? "",
    trigger: (r.trigger ?? "ON_ACCEPTANCE") as "ON_ACCEPTANCE",
    days: r.days || 0,
  }));
}

export async function createPaymentTermAction(_: FormState, formData: FormData) {
  return run(formData, async (v) =>
    createPaymentTerm(await requireActor(), {
      code: v.code ?? "",
      name: v.name ?? "",
      description: v.description,
      instalments: instalmentsFrom(v),
    }),
  );
}

export async function paymentTermCommandAction(_: FormState, formData: FormData) {
  return run(formData, async ({ id = "", command }) => {
    const actor = await requireActor();
    if (command === "default") return setDefaultPaymentTerm(actor, id);
    return setPaymentTermArchived(actor, id, command === "archive");
  });
}

export async function createUnitAction(_: FormState, formData: FormData) {
  return run(formData, async (v) =>
    createUnit(await requireActor(), { code: v.code ?? "", name: v.name ?? "" }),
  );
}

export async function unitCommandAction(_: FormState, formData: FormData) {
  return run(formData, async ({ id = "", command }) =>
    setUnitArchived(await requireActor(), id, command === "archive"),
  );
}

export async function createStageAction(_: FormState, formData: FormData) {
  return run(formData, async (v) =>
    createStage(await requireActor(), {
      name: v.name ?? "",
      kind: (v.kind ?? "OPEN") as "OPEN",
      probability: v.probability,
    }),
  );
}

export async function stageCommandAction(_: FormState, formData: FormData) {
  return run(formData, async ({ id = "", command }) => {
    const actor = await requireActor();
    if (command === "up" || command === "down") return moveStage(actor, id, command);
    return setStageArchived(actor, id, command === "archive");
  });
}

export async function updateQuoteSettingsAction(
  legalEntityId: string,
  _: FormState,
  formData: FormData,
) {
  return run(formData, async (v) =>
    updateCommercialSettings(await requireActor(), legalEntityId, {
      requireQuoteApproval: v.requireQuoteApproval,
      approvalThreshold: v.approvalThreshold,
      quoteValidityDays: v.quoteValidityDays ?? "",
    }),
  );
}

export async function createProjectTypeAction(_: FormState, formData: FormData) {
  return run(formData, async (v) =>
    createProjectType(await requireActor(), {
      code: v.code ?? "",
      name: v.name ?? "",
      description: v.description,
      defaultRevenueModel: (v.defaultRevenueModel ?? "") as "ITEMISED",
    }),
  );
}

export async function projectTypeCommandAction(_: FormState, formData: FormData) {
  return run(formData, async ({ id = "", command }) =>
    setProjectTypeArchived(await requireActor(), id, command === "archive"),
  );
}

export async function createCostCodeAction(_: FormState, formData: FormData) {
  return run(formData, async (v) =>
    createCostCode(await requireActor(), {
      code: v.code ?? "",
      name: v.name ?? "",
      category: (v.category ?? "") as "CREW",
    }),
  );
}

export async function costCodeCommandAction(_: FormState, formData: FormData) {
  return run(formData, async ({ id = "", command }) =>
    setCostCodeArchived(await requireActor(), id, command === "archive"),
  );
}
