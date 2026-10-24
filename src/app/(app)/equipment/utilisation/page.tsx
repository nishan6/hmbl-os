import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { utilisation } from "@/server/equipment/bookings";
import { parseDateOnly, toDateOnly } from "@/lib/fiscal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EquipmentTabs } from "../_components/equipment-tabs";

export const metadata = { title: "Equipment utilisation" };

const DAY = 86_400_000;

export default async function UtilisationPage({
  searchParams,
}: PageProps<"/equipment/utilisation">) {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "equipment.view")) notFound();
  const params = await searchParams;
  const today = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const read = (v: string | string[] | undefined) =>
    typeof v === "string" ? parseDateOnly(v) : null;
  const to = read(params.to) ?? today;
  let from = read(params.from) ?? new Date(to.getTime() - 89 * DAY);
  if (from > to) from = to;
  const rows = await utilisation(actor, { startDate: from, endDate: to });
  const percent = (bps: number | null) => (bps === null ? "—" : `${(bps / 100).toFixed(1)}%`);

  return (
    <>
      <PageHeader
        title="Equipment"
        description="How much of what is held was booked: unit-days on bookings, not cancelled, against unit-days held."
      />
      <EquipmentTabs current="/equipment/utilisation" />
      <form className="mb-4 flex flex-wrap items-end gap-2" action="/equipment/utilisation">
        <label className="text-sm" htmlFor="util-from">
          From
        </label>
        <Input
          id="util-from"
          name="from"
          type="date"
          defaultValue={toDateOnly(from)}
          className="w-40"
        />
        <label className="text-sm" htmlFor="util-to">
          To
        </label>
        <Input id="util-to" name="to" type="date" defaultValue={toDateOnly(to)} className="w-40" />
        <Button type="submit">Show</Button>
      </form>
      <p className="text-secondary mb-3 text-sm">
        Held is what is held today, so items bought or written off during the period skew the
        figure.
      </p>
      <Table dense>
        <THead>
          <tr>
            <TH>Item</TH>
            <TH>Category</TH>
            <TH align="right">Held</TH>
            <TH align="right">Unit-days booked</TH>
            <TH align="right">Unit-days held</TH>
            <TH align="right">Utilisation</TH>
          </tr>
        </THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id}>
              <TD>
                <Link href={`/equipment/${r.id}`} className="text-accent hover:underline">
                  {r.name}
                </Link>{" "}
                <span className="text-muted tabular text-xs">{r.sku}</span>
              </TD>
              <TD className="text-secondary">{r.category}</TD>
              <TD align="right">{r.held}</TD>
              <TD align="right">{r.booked}</TD>
              <TD align="right">{r.capacity}</TD>
              <TD align="right">{percent(r.utilisationBps)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
