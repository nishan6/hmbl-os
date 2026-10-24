import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { equipmentFormOptions } from "@/server/equipment/inventory";
import { inspectionsDue, listMaintenance } from "@/server/equipment/maintenance";
import { inspectionState } from "@/lib/equipment";
import { formatDate } from "@/lib/format";
import { PageHeader, Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EquipmentTabs } from "../_components/equipment-tabs";
import { JobList } from "../_components/job-list";

export const metadata = { title: "Equipment maintenance" };

const FILTERS = [
  { value: "OPEN", label: "Open" },
  { value: "HOLDING", label: "Waiting to return to service" },
  { value: "DONE", label: "Done" },
  { value: "", label: "All" },
] as const;

const today = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);

export default async function MaintenancePage({
  searchParams,
}: PageProps<"/equipment/maintenance">) {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "equipment.view")) notFound();
  const params = await searchParams;
  const status = FILTERS.find((f) => f.value === params.status)?.value ?? "OPEN";
  const [jobs, due, options] = await Promise.all([
    listMaintenance(actor, { status: status || undefined }),
    inspectionsDue(actor),
    equipmentFormOptions(actor),
  ]);
  const now = today();
  return (
    <>
      <PageHeader
        title="Equipment"
        description="Faults, repairs, scheduled maintenance and inspections across all equipment."
      />
      <EquipmentTabs current="/equipment/maintenance" />

      <Section title="Inspections due" description="Overdue, or due in the next two weeks.">
        {due.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Asset</TH>
                <TH>Item</TH>
                <TH>Due</TH>
              </tr>
            </THead>
            <TBody>
              {due.map((a) => (
                <TR key={a.id}>
                  <TD className="tabular">
                    <Link
                      href={`/equipment/assets/${a.id}`}
                      className="text-accent hover:underline"
                    >
                      {a.assetTag}
                    </Link>
                  </TD>
                  <TD>{a.item.name}</TD>
                  <TD className="tabular whitespace-nowrap">
                    {formatDate(a.nextInspectionDue!, "UTC")}{" "}
                    <StatusBadge
                      status={
                        inspectionState(a.nextInspectionDue, now) === "overdue" ? "overdue" : "due"
                      }
                      className="ml-1"
                    />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-secondary text-sm">Nothing due.</p>
        )}
      </Section>

      <Section title="Jobs">
        <nav aria-label="Show jobs" className="mb-3 flex flex-wrap gap-3 text-sm">
          {FILTERS.map((f) => (
            <Link
              key={f.value}
              href={
                f.value
                  ? `/equipment/maintenance?status=${f.value}`
                  : "/equipment/maintenance?status="
              }
              aria-current={f.value === status ? "page" : undefined}
              className="text-accent aria-[current=page]:text-text hover:underline aria-[current=page]:font-medium aria-[current=page]:no-underline"
            >
              {f.label}
            </Link>
          ))}
        </nav>
        <JobList
          jobs={jobs}
          rights={{
            edit: can(actor, "equipment.edit"),
            approve: can(actor, "equipment.approve"),
            archive: can(actor, "equipment.archive"),
          }}
          vendors={options.vendors.map((v) => ({ id: v.id, label: v.name }))}
          currency="INR"
        />
      </Section>
    </>
  );
}
