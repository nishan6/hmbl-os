import { can, canEverywhere } from "@/server/permissions/authorize";
import { listExpenseCategories } from "@/server/expenses/categories";
import { minorToInput } from "@/lib/money";
import { listPeriods } from "@/server/finance/periods";
import { getFinanceSettings, REVENUE_RECOGNITION } from "@/server/finance/settings";
import { DetailList, Panel, Section } from "@/components/ui/page";
import { FinanceHeader } from "../_components/finance-header";
import { loadFinancePage } from "../_components/load";
import { updateExpenseCategoryAction, updateFinanceSettingsAction } from "./actions";
import { CategoryForm } from "./category-form";
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
  const [settings, periods, categories] = await Promise.all([
    getFinanceSettings(actor, entity.id),
    listPeriods(actor, entity.id),
    listExpenseCategories({ includeArchived: true }),
  ]);
  const configureAll = canEverywhere(actor, "finance.configure");
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
      <Section
        title="Expense categories"
        description="For every company. Each category posts to the account with its code in the company's chart; a line over its limit, or without a needed receipt, must say why."
      >
        {categories.map((c) =>
          configureAll ? (
            <Panel key={c.id} className="mb-3">
              <CategoryForm
                action={updateExpenseCategoryAction.bind(null, c.id)}
                defaults={{
                  name: c.name,
                  accountCode: c.accountCode,
                  limit: c.limitMinor === null ? "" : minorToInput(c.limitMinor, "INR"),
                  receiptRequired: String(c.receiptRequired),
                  archived: String(c.status === "ARCHIVED"),
                }}
              />
            </Panel>
          ) : null,
        )}
        {configureAll ? null : (
          <DetailList
            items={categories
              .filter((c) => c.status === "ACTIVE")
              .map((c) => ({
                label: c.name,
                value: `${c.accountCode}${c.limitMinor === null ? "" : ` · limit ${minorToInput(c.limitMinor, "INR")} INR`}${c.receiptRequired ? " · receipt needed" : ""}`,
              }))}
          />
        )}
      </Section>
    </>
  );
}
