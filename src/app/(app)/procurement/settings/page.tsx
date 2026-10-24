import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { getProcurementSettings } from "@/server/procurement/settings";
import { getEntityContext } from "@/server/shell/entity-context";
import { formatMoney } from "@/lib/format";
import { minorToInput } from "@/lib/money";
import { PageHeader, Section } from "@/components/ui/page";
import { procurementSettingsAction } from "../actions";
import { SettingsForm } from "../order-forms";
import { ProcurementTabs } from "../_components/procurement-tabs";

export const metadata = { title: "Procurement settings" };

export default async function ProcurementSettingsPage() {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "procurement.view")) notFound();
  const { entities } = await getEntityContext(actor);
  const visible = entities.filter((e) => can(actor, "procurement.view", { legalEntityId: e.id }));
  const rows = await Promise.all(
    visible.map(async (e) => ({
      ...(await getProcurementSettings(actor, e.id)),
      configure: can(actor, "procurement.configure", { legalEntityId: e.id }),
    })),
  );
  return (
    <>
      <PageHeader
        title="Procurement"
        description="When a purchase order needs approval, for each legal entity."
      />
      <ProcurementTabs current="/procurement/settings" />
      {rows.map(({ entity, settings, configure }) => (
        <Section key={entity.id} title={`${entity.code} · ${entity.legalName}`}>
          {configure ? (
            <SettingsForm
              action={procurementSettingsAction.bind(null, entity.id)}
              defaults={{
                approvalThreshold: minorToInput(
                  settings.approvalThresholdMinor,
                  entity.baseCurrency,
                ),
              }}
              currency={entity.baseCurrency}
            />
          ) : (
            <p className="text-text text-sm">
              Orders above{" "}
              <span className="tabular">
                {formatMoney(settings.approvalThresholdMinor, entity.baseCurrency)}
              </span>{" "}
              before tax need approval.
            </p>
          )}
        </Section>
      ))}
    </>
  );
}
