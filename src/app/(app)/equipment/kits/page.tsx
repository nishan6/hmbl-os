import Link from "next/link";
import { notFound } from "next/navigation";
import { Package, Plus } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { listKits } from "@/server/equipment/inventory";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EquipmentTabs } from "../_components/equipment-tabs";

export const metadata = { title: "Equipment kits" };

export default async function KitsPage() {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "equipment.view")) notFound();
  const kits = await listKits(actor, { includeArchived: true });
  return (
    <>
      <PageHeader
        title="Equipment"
        description="Kits bundle items that go out together, such as a wireless mic kit."
        actions={
          can(actor, "equipment.edit") ? (
            <Button asChild variant="primary">
              <Link href="/equipment/kits/new">
                <Plus aria-hidden />
                New kit
              </Link>
            </Button>
          ) : null
        }
      />
      <EquipmentTabs current="/equipment/kits" />
      {kits.length ? (
        <Table>
          <THead>
            <tr>
              <TH>Code</TH>
              <TH>Kit</TH>
              <TH>Contents</TH>
              <TH>Status</TH>
            </tr>
          </THead>
          <TBody>
            {kits.map((k) => (
              <TR key={k.id}>
                <TD className="tabular">{k.code}</TD>
                <TD className="font-medium">
                  <span className="flex items-center gap-2">
                    <Link href={`/equipment/kits/${k.id}`} className="text-accent hover:underline">
                      {k.name}
                    </Link>
                    {k.isDemo ? <Tag tone="warning">Demo</Tag> : null}
                  </span>
                </TD>
                <TD className="text-secondary">
                  {k.components.map((c) => `${c.quantity} × ${c.item.name}`).join(", ")}
                </TD>
                <TD>
                  <StatusBadge status={k.status === "ACTIVE" ? "active" : "archived"} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState
          icon={Package}
          title="No kits yet"
          description="Bundle items that always go out together so they can be booked as one."
        />
      )}
    </>
  );
}
