import Link from "next/link";
import { notFound } from "next/navigation";
import { Boxes, Plus, Search } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { listCategories, listItems, EQUIPMENT_TRACKING } from "@/server/equipment/inventory";
import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EquipmentTabs } from "./_components/equipment-tabs";

export const metadata = { title: "Equipment" };

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function EquipmentPage({ searchParams }: PageProps<"/equipment">) {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "equipment.view")) notFound();
  const params = await searchParams;
  const q = str(params.q);
  const categoryId = str(params.category);
  const archived = params.archived === "1";
  const [items, categories] = await Promise.all([
    listItems(actor, { search: q, categoryId: categoryId || undefined, includeArchived: archived }),
    listCategories(actor),
  ]);
  const filtered = Boolean(q || categoryId || archived);

  return (
    <>
      <PageHeader
        title="Equipment"
        description="What HMBL owns and leases: fixtures, audio, video, staging and stock. Shared by every legal entity."
        actions={
          can(actor, "equipment.create") ? (
            <Button asChild variant="primary">
              <Link href="/equipment/new">
                <Plus aria-hidden />
                New item
              </Link>
            </Button>
          ) : null
        }
      />
      <EquipmentTabs current="/equipment" />

      <form role="search" className="mb-4 flex flex-wrap items-end gap-2" action="/equipment">
        <label className="sr-only" htmlFor="equipment-search">
          Search equipment
        </label>
        <Input
          id="equipment-search"
          name="q"
          defaultValue={q}
          placeholder="Name, SKU, make, asset tag or serial"
          className="max-w-xs"
        />
        <label className="sr-only" htmlFor="equipment-category">
          Category
        </label>
        <Select id="equipment-category" name="category" defaultValue={categoryId} className="w-48">
          <option value="">Every category</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <label className="text-secondary flex h-8 items-center gap-2 text-sm">
          <input type="checkbox" name="archived" value="1" defaultChecked={archived} />
          Include archived
        </label>
        <Button type="submit">
          <Search aria-hidden />
          Search
        </Button>
      </form>

      {items.length ? (
        <Table>
          <THead>
            <tr>
              <TH>SKU</TH>
              <TH>Item</TH>
              <TH>Category</TH>
              <TH>Tracked</TH>
              <TH align="right">Held</TH>
              <TH align="right">Available</TH>
              <TH align="right">Rental per day</TH>
              <TH>Status</TH>
            </tr>
          </THead>
          <TBody>
            {items.map((i) => (
              <TR key={i.id}>
                <TD className="tabular">{i.sku}</TD>
                <TD className="font-medium">
                  <span className="flex items-center gap-2">
                    <Link href={`/equipment/${i.id}`} className="text-accent hover:underline">
                      {i.name}
                    </Link>
                    {i.isDemo ? <Tag tone="warning">Demo</Tag> : null}
                  </span>
                  {i.manufacturer || i.model ? (
                    <span className="text-muted block text-xs">
                      {[i.manufacturer, i.model].filter(Boolean).join(" ")}
                    </span>
                  ) : null}
                </TD>
                <TD className="text-secondary">{i.category.name}</TD>
                <TD className="text-secondary">{EQUIPMENT_TRACKING[i.tracking]}</TD>
                <TD align="right">{i.held}</TD>
                <TD align="right">{i.available}</TD>
                <TD align="right">
                  {i.rentalDayRateMinor === null
                    ? "—"
                    : formatMoney(i.rentalDayRateMinor, i.currency)}
                </TD>
                <TD>
                  <StatusBadge status={i.status === "ACTIVE" ? "active" : "archived"} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState
          icon={Boxes}
          title={filtered ? "No equipment matches" : "No equipment yet"}
          description={
            filtered
              ? "Try another name or category, or include archived items."
              : categories.length
                ? "Add the items HMBL holds, then their assets or stock."
                : "Start by adding categories, such as Lighting or Audio, then the items in them."
          }
        />
      )}
    </>
  );
}
