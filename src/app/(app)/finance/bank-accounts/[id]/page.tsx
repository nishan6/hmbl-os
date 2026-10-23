import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { getBankAccount } from "@/server/finance/bank-accounts";
import { financeEntity } from "@/server/finance/context";
import { can } from "@/server/permissions/authorize";
import { AppError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { DetailList, Panel, Section } from "@/components/ui/page";
import { FinanceHeader, withEntity } from "../../_components/finance-header";
import { updateBankAccountAction } from "../actions";
import { BankAccountForm } from "../bank-account-form";

export const metadata = { title: "Bank account" };

export default async function BankAccountPage({
  params,
}: PageProps<"/finance/bank-accounts/[id]">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const account = await getBankAccount(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const { entities, entity } = await financeEntity(actor, account.legalEntityId);
  if (!entity) notFound();
  const configure = can(actor, "finance.configure", { legalEntityId: entity.id });
  return (
    <>
      <FinanceHeader
        title={`${account.bankName} ···${account.accountNumber.slice(-4)}`}
        entity={entity}
        entities={entities}
        crumbs={[
          { label: "Bank accounts", href: withEntity("/finance/bank-accounts", entity) },
          { label: account.bankName },
        ]}
        actions={
          <Button asChild variant="primary">
            <Link href={`/finance/bank-accounts/${id}/reconcile`}>Reconcile</Link>
          </Button>
        }
      />
      {configure ? (
        <Section title="Details">
          <Panel>
            <BankAccountForm
              action={updateBankAccountAction.bind(null, id)}
              defaults={{
                bankName: account.bankName,
                branch: account.branch ?? "",
                accountName: account.accountName,
                accountNumber: account.accountNumber,
                ifsc: account.ifsc ?? "",
                swift: account.swift ?? "",
                iban: account.iban ?? "",
                currency: account.currency,
                showOnInvoices: account.showOnInvoices ? "true" : "",
              }}
              submitLabel="Save changes"
            />
          </Panel>
        </Section>
      ) : (
        <Section title="Details">
          <DetailList
            items={[
              { label: "Bank", value: account.bankName },
              { label: "Account name", value: account.accountName },
              { label: "Account number", value: account.accountNumber },
              { label: "Currency", value: account.currency },
            ]}
          />
        </Section>
      )}
    </>
  );
}
