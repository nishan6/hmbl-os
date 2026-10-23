import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can, canEverywhere } from "@/server/permissions/authorize";
import { listStages } from "@/server/crm/pipeline";
import { STAGE_KINDS } from "@/server/crm/pipeline-schemas";
import {
  canViewMasterData,
  listPaymentTerms,
  listTaxRates,
  listUnits,
} from "@/server/master-data/service";
import { TAX_TREATMENTS } from "@/server/master-data/schemas";
import { listCommercialSettings } from "@/server/commercial/settings";
import { formatMoney } from "@/lib/format";
import { minorToInput } from "@/lib/money";
import { formatBps } from "@/lib/percent";
import { ActionButton } from "@/components/ui/action-button";
import { PageHeader, Panel, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import {
  paymentTermCommandAction,
  stageCommandAction,
  taxRateCommandAction,
  unitCommandAction,
  updateQuoteSettingsAction,
} from "./actions";
import { QuoteSettingsForm } from "./quote-settings-form";
import { PaymentTermForm, TaxRateForm, UnitForm } from "./forms";
import { StageForm } from "./stage-form";

export const metadata = { title: "Master data" };

function instalmentText(i: { label: string; percentBps: number; trigger: string; days: number }) {
  const due =
    i.trigger === "BEFORE_START"
      ? `${i.days} days before the start`
      : i.trigger === "AFTER_DELIVERY"
        ? `${i.days} days after delivery`
        : i.trigger === "ON_ACCEPTANCE"
          ? "on acceptance"
          : "on delivery";
  return `${formatBps(i.percentBps)} ${i.label.toLowerCase()}, ${due}`;
}

export default async function MasterDataPage() {
  const actor = await requireActorOrRedirect();
  if (!canViewMasterData(actor)) notFound();
  const [taxRates, terms, units] = await Promise.all([
    listTaxRates(actor, { includeArchived: true }),
    listPaymentTerms(actor, { includeArchived: true }),
    listUnits(actor, { includeArchived: true }),
  ]);
  const quoteRules = can(actor, "commercial.view") ? await listCommercialSettings(actor) : [];
  const stages = can(actor, "crm.view") ? await listStages(actor, { includeArchived: true }) : [];
  const canStages = canEverywhere(actor, "crm.configure");
  const canTax = canEverywhere(actor, "finance.configure");
  const canCommercial = canEverywhere(actor, "commercial.configure");

  return (
    <>
      <PageHeader
        title="Master data"
        description="Tax rates, payment terms, units and pipeline stages used across the CRM, quotes and invoices. Documents keep a copy of what they used, so changes here never alter an issued document."
        breadcrumbs={[{ label: "Administration" }, { label: "Master data" }]}
      />

      {quoteRules.length ? (
        <Section
          title="Quote rules"
          description="Per legal entity. Approval is off by default: whoever prepares a quote can issue it."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            {quoteRules.map(({ entity, canConfigure, settings }) => (
              <Panel key={entity.id}>
                <h3 className="text-text mb-3 text-sm font-semibold">
                  {entity.code} · {entity.legalName}
                </h3>
                {canConfigure ? (
                  <QuoteSettingsForm
                    action={updateQuoteSettingsAction.bind(null, entity.id)}
                    baseCurrency={entity.baseCurrency}
                    defaults={{
                      requireQuoteApproval: settings.requireQuoteApproval ? "on" : "",
                      approvalThreshold:
                        settings.approvalThresholdMinor === null
                          ? ""
                          : minorToInput(settings.approvalThresholdMinor, entity.baseCurrency),
                      quoteValidityDays: String(settings.quoteValidityDays),
                    }}
                  />
                ) : (
                  <p className="text-secondary text-sm">
                    {settings.requireQuoteApproval
                      ? `Director approval required${
                          settings.approvalThresholdMinor === null
                            ? ""
                            : ` above ${formatMoney(settings.approvalThresholdMinor, entity.baseCurrency)}`
                        }.`
                      : "No approval needed."}{" "}
                    Quotes are valid for {settings.quoteValidityDays} days.
                  </p>
                )}
              </Panel>
            ))}
          </div>
        </Section>
      ) : null}

      <Section
        title="Tax rates"
        description="New lines use the default rate for the entity's country. Rates can't be edited; archive one and add a replacement."
      >
        <Table dense>
          <THead>
            <tr>
              <TH>Country</TH>
              <TH>Code</TH>
              <TH>Name</TH>
              <TH>Treatment</TH>
              <TH align="right">Rate</TH>
              <TH>Status</TH>
              {canTax ? <TH>Actions</TH> : null}
            </tr>
          </THead>
          <TBody>
            {taxRates.map((t) => (
              <TR key={t.id}>
                <TD className="text-secondary">{t.countryCode}</TD>
                <TD className="font-medium">{t.code}</TD>
                <TD>
                  <span className="flex items-center gap-2">
                    {t.name}
                    {t.isDefault ? <Tag tone="accent">Default</Tag> : null}
                  </span>
                </TD>
                <TD className="text-secondary">{TAX_TREATMENTS[t.treatment]}</TD>
                <TD align="right">{formatBps(t.rateBps)}</TD>
                <TD>
                  <StatusBadge status={t.status === "ACTIVE" ? "active" : "archived"} />
                </TD>
                {canTax ? (
                  <TD>
                    <span className="flex gap-1">
                      {t.status === "ACTIVE" && !t.isDefault ? (
                        <ActionButton
                          action={taxRateCommandAction}
                          fields={{ id: t.id, command: "default" }}
                        >
                          Make default
                        </ActionButton>
                      ) : null}
                      {!t.isDefault ? (
                        <ActionButton
                          action={taxRateCommandAction}
                          fields={{
                            id: t.id,
                            command: t.status === "ACTIVE" ? "archive" : "restore",
                          }}
                        >
                          {t.status === "ACTIVE" ? "Archive" : "Restore"}
                        </ActionButton>
                      ) : null}
                    </span>
                  </TD>
                ) : null}
              </TR>
            ))}
          </TBody>
        </Table>
        {canTax ? (
          <Panel className="mt-4">
            <TaxRateForm />
          </Panel>
        ) : null}
      </Section>

      <Section
        title="Payment terms"
        description="How a quote's total is split into instalments. New quotes use the default."
      >
        <Table dense>
          <THead>
            <tr>
              <TH>Code</TH>
              <TH>Name</TH>
              <TH>Schedule</TH>
              <TH>Status</TH>
              {canCommercial ? <TH>Actions</TH> : null}
            </tr>
          </THead>
          <TBody>
            {terms.map((t) => (
              <TR key={t.id}>
                <TD className="font-medium">{t.code}</TD>
                <TD>
                  <span className="flex items-center gap-2">
                    {t.name}
                    {t.isDefault ? <Tag tone="accent">Default</Tag> : null}
                  </span>
                </TD>
                <TD className="text-secondary">{t.instalments.map(instalmentText).join("; ")}</TD>
                <TD>
                  <StatusBadge status={t.status === "ACTIVE" ? "active" : "archived"} />
                </TD>
                {canCommercial ? (
                  <TD>
                    <span className="flex gap-1">
                      {t.status === "ACTIVE" && !t.isDefault ? (
                        <ActionButton
                          action={paymentTermCommandAction}
                          fields={{ id: t.id, command: "default" }}
                        >
                          Make default
                        </ActionButton>
                      ) : null}
                      {!t.isDefault ? (
                        <ActionButton
                          action={paymentTermCommandAction}
                          fields={{
                            id: t.id,
                            command: t.status === "ACTIVE" ? "archive" : "restore",
                          }}
                        >
                          {t.status === "ACTIVE" ? "Archive" : "Restore"}
                        </ActionButton>
                      ) : null}
                    </span>
                  </TD>
                ) : null}
              </TR>
            ))}
          </TBody>
        </Table>
        {canCommercial ? (
          <Panel className="mt-4">
            <PaymentTermForm />
          </Panel>
        ) : null}
      </Section>

      <Section title="Units" description="Units of measure for quantities on quotes.">
        <Table dense>
          <THead>
            <tr>
              <TH>Code</TH>
              <TH>Name</TH>
              <TH>Status</TH>
              {canCommercial ? <TH>Actions</TH> : null}
            </tr>
          </THead>
          <TBody>
            {units.map((u) => (
              <TR key={u.id}>
                <TD className="font-medium">{u.code}</TD>
                <TD>{u.name}</TD>
                <TD>
                  <StatusBadge status={u.status === "ACTIVE" ? "active" : "archived"} />
                </TD>
                {canCommercial ? (
                  <TD>
                    <ActionButton
                      action={unitCommandAction}
                      fields={{ id: u.id, command: u.status === "ACTIVE" ? "archive" : "restore" }}
                    >
                      {u.status === "ACTIVE" ? "Archive" : "Restore"}
                    </ActionButton>
                  </TD>
                ) : null}
              </TR>
            ))}
          </TBody>
        </Table>
        {canCommercial ? (
          <Panel className="mt-4 max-w-xl">
            <UnitForm />
          </Panel>
        ) : null}
      </Section>
      {stages.length ? (
        <Section
          title="Pipeline stages"
          description="The CRM board shows open stages in this order. A stage's kind never changes; probabilities are defaults each opportunity can override."
        >
          <Table dense>
            <THead>
              <tr>
                <TH>Stage</TH>
                <TH>Kind</TH>
                <TH align="right">Probability</TH>
                <TH>Status</TH>
                {canStages ? <TH>Actions</TH> : null}
              </tr>
            </THead>
            <TBody>
              {stages.map((s, i) => (
                <TR key={s.id}>
                  <TD className="font-medium">{s.name}</TD>
                  <TD className="text-secondary">{STAGE_KINDS[s.kind]}</TD>
                  <TD align="right">
                    {s.probabilityBps === null ? "—" : formatBps(s.probabilityBps)}
                  </TD>
                  <TD>
                    <StatusBadge status={s.status === "ACTIVE" ? "active" : "archived"} />
                  </TD>
                  {canStages ? (
                    <TD>
                      <span className="flex gap-1">
                        {s.status === "ACTIVE" && i > 0 ? (
                          <ActionButton
                            action={stageCommandAction}
                            fields={{ id: s.id, command: "up" }}
                          >
                            Move up<span className="sr-only"> {s.name}</span>
                          </ActionButton>
                        ) : null}
                        {s.status === "ACTIVE" && i < stages.length - 1 ? (
                          <ActionButton
                            action={stageCommandAction}
                            fields={{ id: s.id, command: "down" }}
                          >
                            Move down<span className="sr-only"> {s.name}</span>
                          </ActionButton>
                        ) : null}
                        <ActionButton
                          action={stageCommandAction}
                          fields={{
                            id: s.id,
                            command: s.status === "ACTIVE" ? "archive" : "restore",
                          }}
                        >
                          {s.status === "ACTIVE" ? "Archive" : "Restore"}
                          <span className="sr-only"> {s.name}</span>
                        </ActionButton>
                      </span>
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
          {canStages ? (
            <Panel className="mt-4">
              <StageForm />
            </Panel>
          ) : null}
        </Section>
      ) : null}
    </>
  );
}
