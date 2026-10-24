import { can, canEverywhere } from "@/server/permissions/authorize";
import { listExpenseCategories } from "@/server/expenses/categories";
import { minorToInput } from "@/lib/money";
import { listPeriods } from "@/server/finance/periods";
import { listInvoiceServices } from "@/server/finance/invoice-services";
import { getFinanceSettings, REVENUE_RECOGNITION } from "@/server/finance/settings";
import { DetailList, Panel, Section } from "@/components/ui/page";
import { FinanceHeader } from "../_components/finance-header";
import { loadFinancePage } from "../_components/load";
import {
  createInvoiceServiceAction,
  updateExpenseCategoryAction,
  updateFinanceSettingsAction,
  updateInvoiceServiceAction,
} from "./actions";
import { CategoryForm } from "./category-form";
import { ServiceForm } from "./service-form";
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
  const [settings, periods, categories, services] = await Promise.all([
    getFinanceSettings(actor, entity.id),
    listPeriods(actor, entity.id),
    listExpenseCategories({ includeArchived: true }),
    listInvoiceServices(actor, entity.id, { includeArchived: true }),
  ]);
  const configureAll = canEverywhere(actor, "finance.configure");
  const configure = can(actor, "finance.configure", { legalEntityId: entity.id });
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
            disabled={!configure}
          />
        </Panel>
      </Section>
      <Section
        title="Invoice services"
        description="What this company sells, as coded in invoice numbers with {SERVICE}, e.g. VLR for rentals. Each invoice picks one. Codes can't change once added."
      >
        {configure ? (
          <>
            {services.map((s) => (
              <Panel key={s.id} className="mb-3">
                <ServiceForm
                  action={updateInvoiceServiceAction.bind(null, s.id)}
                  code={s.code}
                  defaults={{ name: s.name, archived: String(s.status === "ARCHIVED") }}
                />
              </Panel>
            ))}
            <Panel>
              <ServiceForm
                action={createInvoiceServiceAction.bind(null, entity.id)}
                defaults={{ code: "", name: "" }}
              />
            </Panel>
          </>
        ) : (
          <DetailList
            items={
              services.filter((s) => s.status === "ACTIVE").length
                ? services
                    .filter((s) => s.status === "ACTIVE")
                    .map((s) => ({ label: s.code, value: s.name }))
                : [{ label: "Services", value: "None yet" }]
            }
          />
        )}
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
