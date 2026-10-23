import Link from "next/link";
import { Landmark } from "lucide-react";
import { can } from "@/server/permissions/authorize";
import { listBankAccounts } from "@/server/finance/bank-accounts";
import { formatMoney } from "@/lib/format";
import { EmptyState, Panel, Section } from "@/components/ui/page";
import { Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FinanceHeader } from "../_components/finance-header";
import { loadFinancePage } from "../_components/load";
import { createBankAccountAction } from "./actions";
import { BankAccountForm } from "./bank-account-form";

export const metadata = { title: "Bank accounts" };

export default async function BankAccountsPage({
  searchParams,
}: PageProps<"/finance/bank-accounts">) {
  const { actor, entities, entity } = await loadFinancePage(searchParams);
  const accounts = await listBankAccounts(actor, entity.id);
  const configure = can(actor, "finance.configure", { legalEntityId: entity.id });
  return (
    <>
      <FinanceHeader
        title="Bank accounts"
        description="Where money is received and paid. Each has its own ledger account."
        entity={entity}
        entities={entities}
        current="/finance/bank-accounts"
      />
      {accounts.length ? (
        <Table dense>
          <THead>
            <tr>
              <TH>Bank</TH>
              <TH>Account</TH>
              <TH>Ledger account</TH>
              <TH>Currency</TH>
              <TH align="right">Balance in the books</TH>
            </tr>
          </THead>
          <TBody>
            {accounts.map((a) => (
              <TR key={a.id}>
                <TD>
                  <Link
                    href={`/finance/bank-accounts/${a.id}`}
                    className="text-accent hover:underline"
                  >
                    {a.bankName}
                  </Link>
                  {a.showOnInvoices ? (
                    <Tag tone="info" className="ml-2">
                      On invoices
                    </Tag>
                  ) : null}
                </TD>
                <TD className="tabular text-secondary">
                  {a.accountName} · {a.accountNumber}
                </TD>
                <TD className="tabular">
                  <Link
                    href={`/finance/accounts/${a.ledgerAccount.id}`}
                    className="text-accent hover:underline"
                  >
                    {a.ledgerAccount.code}
                  </Link>
                </TD>
                <TD>{a.currency}</TD>
                <TD align="right">{formatMoney(a.balanceMinor, entity.baseCurrency)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState
          icon={Landmark}
          title="No bank accounts yet"
          description="Add the company's bank accounts to record receipts and payments."
        />
      )}
      {configure ? (
        <Section title="Add a bank account">
          <Panel>
            <BankAccountForm
              action={createBankAccountAction.bind(null, entity.id)}
              defaults={{ currency: entity.baseCurrency }}
              submitLabel="Add bank account"
            />
          </Panel>
        </Section>
      ) : null}
    </>
  );
}
