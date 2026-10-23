import type { AccountSubtype, AccountType } from "@/generated/prisma/enums";

/*
 * DEFAULT CHART OF ACCOUNTS — a labelled starting point for an Indian live
 * production company, not an approved chart (docs/decisions.md, "Chart of
 * accounts"). HMBL's accountant should review it before go-live; accounts can
 * be renamed, added and archived in Finance → Chart of accounts.
 *
 * `key` marks the accounts automatic postings use. Their codes and names can
 * change; the key is how the posting code finds them.
 */

export const SYSTEM_ACCOUNTS = {
  RECEIVABLES: "Trade receivables",
  PAYABLES: "Trade payables",
  EMPLOYEE_ADVANCES: "Advances to staff and crew",
  REIMBURSEMENTS_PAYABLE: "Reimbursements payable",
  CLIENT_ADVANCES: "Advances from clients",
  OUTPUT_CGST: "Output CGST",
  OUTPUT_SGST: "Output SGST",
  OUTPUT_IGST: "Output IGST",
  INPUT_CGST: "Input CGST",
  INPUT_SGST: "Input SGST",
  INPUT_IGST: "Input IGST",
  OUTPUT_TAX: "Output tax",
  INPUT_TAX: "Input tax",
  TDS_RECEIVABLE: "TDS receivable",
  TDS_PAYABLE: "TDS payable",
  REVENUE: "Default revenue",
  DIRECT_COSTS: "Default direct costs",
  ROUNDING: "Rounding",
  BAD_DEBTS: "Bad debts",
  FX_GAIN: "Exchange gains",
  FX_LOSS: "Exchange losses",
  BANK_CHARGES: "Bank charges",
  RETAINED_EARNINGS: "Retained earnings",
  OPENING_BALANCES: "Opening balance equity",
  SUSPENSE: "Suspense",
} as const;

export type SystemAccountKey = keyof typeof SYSTEM_ACCOUNTS;

export type DefaultAccount = {
  code: string;
  name: string;
  type: AccountType;
  subtype: AccountSubtype;
  key?: SystemAccountKey;
  control?: boolean;
  /** Only for entities in these countries. */
  countries?: string[];
  /** Not for entities in these countries. */
  notCountries?: string[];
};

const IN = ["IN"];

export const DEFAULT_CHART: DefaultAccount[] = [
  // Assets
  { code: "1000", name: "Cash in hand", type: "ASSET", subtype: "CASH" },
  { code: "1010", name: "Petty cash", type: "ASSET", subtype: "CASH" },
  {
    code: "1200",
    name: "Trade receivables",
    type: "ASSET",
    subtype: "RECEIVABLE",
    key: "RECEIVABLES",
    control: true,
  },
  {
    code: "1300",
    name: "TDS receivable",
    type: "ASSET",
    subtype: "CURRENT_ASSET",
    key: "TDS_RECEIVABLE",
    countries: IN,
  },
  {
    code: "1310",
    name: "Input CGST",
    type: "ASSET",
    subtype: "CURRENT_ASSET",
    key: "INPUT_CGST",
    countries: IN,
  },
  {
    code: "1311",
    name: "Input SGST",
    type: "ASSET",
    subtype: "CURRENT_ASSET",
    key: "INPUT_SGST",
    countries: IN,
  },
  {
    code: "1312",
    name: "Input IGST",
    type: "ASSET",
    subtype: "CURRENT_ASSET",
    key: "INPUT_IGST",
    countries: IN,
  },
  {
    code: "1320",
    name: "Input VAT",
    type: "ASSET",
    subtype: "CURRENT_ASSET",
    key: "INPUT_TAX",
    notCountries: IN,
  },
  {
    code: "1400",
    name: "Advances to staff and crew",
    type: "ASSET",
    subtype: "CURRENT_ASSET",
    key: "EMPLOYEE_ADVANCES",
    control: true,
  },
  { code: "1410", name: "Advances to suppliers", type: "ASSET", subtype: "CURRENT_ASSET" },
  { code: "1420", name: "Security deposits", type: "ASSET", subtype: "CURRENT_ASSET" },
  { code: "1430", name: "Prepaid expenses", type: "ASSET", subtype: "CURRENT_ASSET" },
  { code: "1500", name: "Production equipment", type: "ASSET", subtype: "FIXED_ASSET" },
  { code: "1510", name: "Computers and office equipment", type: "ASSET", subtype: "FIXED_ASSET" },
  { code: "1520", name: "Furniture and fittings", type: "ASSET", subtype: "FIXED_ASSET" },
  { code: "1530", name: "Vehicles", type: "ASSET", subtype: "FIXED_ASSET" },
  { code: "1590", name: "Accumulated depreciation", type: "ASSET", subtype: "FIXED_ASSET" },
  // Liabilities
  {
    code: "2000",
    name: "Trade payables",
    type: "LIABILITY",
    subtype: "PAYABLE",
    key: "PAYABLES",
    control: true,
  },
  {
    code: "2100",
    name: "Output CGST",
    type: "LIABILITY",
    subtype: "CURRENT_LIABILITY",
    key: "OUTPUT_CGST",
    countries: IN,
  },
  {
    code: "2101",
    name: "Output SGST",
    type: "LIABILITY",
    subtype: "CURRENT_LIABILITY",
    key: "OUTPUT_SGST",
    countries: IN,
  },
  {
    code: "2102",
    name: "Output IGST",
    type: "LIABILITY",
    subtype: "CURRENT_LIABILITY",
    key: "OUTPUT_IGST",
    countries: IN,
  },
  {
    code: "2110",
    name: "Output VAT",
    type: "LIABILITY",
    subtype: "CURRENT_LIABILITY",
    key: "OUTPUT_TAX",
    notCountries: IN,
  },
  {
    code: "2200",
    name: "TDS payable",
    type: "LIABILITY",
    subtype: "CURRENT_LIABILITY",
    key: "TDS_PAYABLE",
    countries: IN,
  },
  { code: "2210", name: "Salaries payable", type: "LIABILITY", subtype: "CURRENT_LIABILITY" },
  {
    code: "2220",
    name: "Reimbursements payable",
    type: "LIABILITY",
    subtype: "CURRENT_LIABILITY",
    key: "REIMBURSEMENTS_PAYABLE",
    control: true,
  },
  {
    code: "2300",
    name: "Advances from clients",
    type: "LIABILITY",
    subtype: "CURRENT_LIABILITY",
    key: "CLIENT_ADVANCES",
  },
  { code: "2400", name: "Loans", type: "LIABILITY", subtype: "LONG_TERM_LIABILITY" },
  {
    code: "2900",
    name: "Suspense",
    type: "LIABILITY",
    subtype: "CURRENT_LIABILITY",
    key: "SUSPENSE",
  },
  // Equity
  { code: "3000", name: "Capital", type: "EQUITY", subtype: "EQUITY" },
  {
    code: "3100",
    name: "Retained earnings",
    type: "EQUITY",
    subtype: "EQUITY",
    key: "RETAINED_EARNINGS",
  },
  {
    code: "3900",
    name: "Opening balance equity",
    type: "EQUITY",
    subtype: "EQUITY",
    key: "OPENING_BALANCES",
  },
  // Income
  {
    code: "4000",
    name: "Event production services",
    type: "INCOME",
    subtype: "REVENUE",
    key: "REVENUE",
  },
  { code: "4010", name: "Equipment rental income", type: "INCOME", subtype: "REVENUE" },
  { code: "4020", name: "Crew and technical services", type: "INCOME", subtype: "REVENUE" },
  { code: "4030", name: "Broadcast production", type: "INCOME", subtype: "REVENUE" },
  { code: "4040", name: "Travel and logistics recharged", type: "INCOME", subtype: "REVENUE" },
  { code: "4900", name: "Other income", type: "INCOME", subtype: "OTHER_INCOME" },
  { code: "4910", name: "Exchange gains", type: "INCOME", subtype: "OTHER_INCOME", key: "FX_GAIN" },
  { code: "4920", name: "Interest income", type: "INCOME", subtype: "OTHER_INCOME" },
  // Direct costs
  { code: "5000", name: "Freelance crew", type: "EXPENSE", subtype: "DIRECT_COST" },
  { code: "5010", name: "Equipment hire", type: "EXPENSE", subtype: "DIRECT_COST" },
  { code: "5020", name: "Production and fabrication", type: "EXPENSE", subtype: "DIRECT_COST" },
  { code: "5030", name: "Travel", type: "EXPENSE", subtype: "DIRECT_COST" },
  { code: "5040", name: "Accommodation and meals", type: "EXPENSE", subtype: "DIRECT_COST" },
  { code: "5050", name: "Logistics and freight", type: "EXPENSE", subtype: "DIRECT_COST" },
  { code: "5060", name: "Venue, permits and fees", type: "EXPENSE", subtype: "DIRECT_COST" },
  {
    code: "5090",
    name: "Other direct costs",
    type: "EXPENSE",
    subtype: "DIRECT_COST",
    key: "DIRECT_COSTS",
  },
  // Overheads
  { code: "6000", name: "Salaries and wages", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6010", name: "Rent", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6020", name: "Electricity and internet", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6030", name: "Software subscriptions", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6040", name: "Professional fees", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  {
    code: "6050",
    name: "Bank charges",
    type: "EXPENSE",
    subtype: "OPERATING_EXPENSE",
    key: "BANK_CHARGES",
  },
  { code: "6060", name: "Marketing", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6070", name: "Office expenses", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6080", name: "Depreciation", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  { code: "6090", name: "Repairs and maintenance", type: "EXPENSE", subtype: "OPERATING_EXPENSE" },
  {
    code: "6100",
    name: "Exchange losses",
    type: "EXPENSE",
    subtype: "OPERATING_EXPENSE",
    key: "FX_LOSS",
  },
  {
    code: "6110",
    name: "Bad debts written off",
    type: "EXPENSE",
    subtype: "OPERATING_EXPENSE",
    key: "BAD_DEBTS",
  },
  {
    code: "6120",
    name: "Rounding off",
    type: "EXPENSE",
    subtype: "OPERATING_EXPENSE",
    key: "ROUNDING",
  },
];

export function defaultChartFor(countryCode: string): DefaultAccount[] {
  return DEFAULT_CHART.filter(
    (a) =>
      (!a.countries || a.countries.includes(countryCode)) && !a.notCountries?.includes(countryCode),
  );
}

export const ACCOUNT_TYPES: Record<AccountType, { label: string; normal: "DEBIT" | "CREDIT" }> = {
  ASSET: { label: "Assets", normal: "DEBIT" },
  LIABILITY: { label: "Liabilities", normal: "CREDIT" },
  EQUITY: { label: "Equity", normal: "CREDIT" },
  INCOME: { label: "Income", normal: "CREDIT" },
  EXPENSE: { label: "Expenses", normal: "DEBIT" },
};

export const ACCOUNT_SUBTYPES: Record<AccountSubtype, { label: string; type: AccountType }> = {
  CASH: { label: "Cash", type: "ASSET" },
  BANK: { label: "Bank", type: "ASSET" },
  RECEIVABLE: { label: "Receivables", type: "ASSET" },
  CURRENT_ASSET: { label: "Other current assets", type: "ASSET" },
  FIXED_ASSET: { label: "Fixed assets", type: "ASSET" },
  PAYABLE: { label: "Payables", type: "LIABILITY" },
  CURRENT_LIABILITY: { label: "Current liabilities", type: "LIABILITY" },
  LONG_TERM_LIABILITY: { label: "Long-term liabilities", type: "LIABILITY" },
  EQUITY: { label: "Equity", type: "EQUITY" },
  REVENUE: { label: "Revenue", type: "INCOME" },
  OTHER_INCOME: { label: "Other income", type: "INCOME" },
  DIRECT_COST: { label: "Direct costs", type: "EXPENSE" },
  OPERATING_EXPENSE: { label: "Overheads", type: "EXPENSE" },
};
