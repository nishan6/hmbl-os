import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { claimFormOptions } from "@/server/expenses/claims";
import { can } from "@/server/permissions/authorize";
import { PageHeader } from "@/components/ui/page";
import { startClaimAction } from "../actions";
import { StartClaimForm } from "./start-form";

export const metadata = { title: "New expense claim" };

export default async function NewClaimPage() {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "expenses.create")) notFound();
  const { entities } = await claimFormOptions(actor);
  return (
    <>
      <PageHeader
        title="New expense claim"
        breadcrumbs={[{ label: "Expenses", href: "/expenses" }, { label: "New" }]}
      />
      <StartClaimForm action={startClaimAction} entities={entities} />
    </>
  );
}
