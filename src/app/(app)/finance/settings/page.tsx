import { can } from "@/server/permissions/authorize";
import { listPeriods } from "@/server/finance/periods";
import { getFinanceSettings, REVENUE_RECOGNITION } from "@/server/finance/settings";
import { DetailList, Panel, Section } from "@/components/ui/page";
import { FinanceHeader } from "../_components/finance-header";
import { loadFinancePage } from "../_components/load";
import { updateFinanceSettingsAction } from "./actions";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Finance settings" };

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export default async function FinanceSettingsPage({
  searchParams,
}: PageProps<"/finance/settings">) {
  const { actor, entities, entity } = await loadFinancePage(searchParams);
  const [settings, periods] = await Promise.all([
    getFinanceSettings(actor, entity.id),
    listPeriods(actor, entity.id),
  ]);
  const years = [...new Set(periods.map((p) => p.fiscalYear))];
  return (
    <>
      <FinanceHeader
        title="Finance settings"
        entity={entity}
        entities={entities}
        current="/finance/settings"
      />
      <Section title="Books">
        <DetailList
          items={[
            { label: "Base currency", value: entity.baseCurrency },
            {
              label: "Financial year starts",
              value: MONTHS[settings.fiscalYearStartMonth - 1],
            },
            { label: "Years with periods", value: years.join(", ") || "None yet" },
          ]}
        />
      </Section>
      <Section title="Policies">
        <Panel>
          <SettingsForm
            action={updateFinanceSettingsAction.bind(null, entity.id)}
            defaults={{ revenueRecognition: settings.revenueRecognition }}
            options={REVENUE_RECOGNITION}
            disabled={!can(actor, "finance.configure", { legalEntityId: entity.id })}
          />
        </Panel>
      </Section>
    </>
  );
}
