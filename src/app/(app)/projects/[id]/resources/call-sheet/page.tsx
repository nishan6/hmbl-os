import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { callSheet } from "@/server/crew/assignments";
import { getProject } from "@/server/projects/projects";
import { AppError } from "@/lib/errors";
import { parseDateOnly, toDateOnly } from "@/lib/fiscal";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { EmptyState, Section } from "@/components/ui/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ProjectHeader } from "../../../_components/project-header";

export const metadata = { title: "Call sheet" };

export default async function CallSheetPage({
  params,
  searchParams,
}: PageProps<"/projects/[id]/resources/call-sheet">) {
  const { id } = await params;
  const actor = await requireActorOrRedirect();
  const p = await getProject(actor, id).catch((error: unknown) => {
    if (error instanceof AppError) notFound();
    throw error;
  });
  const asked = (await searchParams).date;
  const day =
    (typeof asked === "string" ? parseDateOnly(asked) : null) ??
    p.eventStartDate ??
    parseDateOnly(toDateOnly(new Date()))!;
  const { crew } = await callSheet(actor, id, day);

  return (
    <>
      <ProjectHeader
        project={p}
        current="/resources"
        showCosts={p.showCosts}
        crumb={[
          { label: "Crew and equipment", href: `/projects/${p.id}/resources` },
          { label: "Call sheet" },
        ]}
      />
      <form className="mb-4 flex flex-wrap items-end gap-2 print:hidden">
        <label className="text-sm font-medium">
          Day
          <Input type="date" name="date" defaultValue={toDateOnly(day)} className="mt-1 w-auto" />
        </label>
        <Button type="submit">Show</Button>
      </form>
      <Section
        title={`Call sheet for ${formatDate(day, "UTC")}`}
        description={[p.venue, p.name].filter(Boolean).join(" · ")}
      >
        {crew.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Call</TH>
                <TH>Name</TH>
                <TH>Role</TH>
                <TH>Report to</TH>
                <TH>Phone</TH>
              </tr>
            </THead>
            <TBody>
              {crew.map((c) => (
                <TR key={c.id}>
                  <TD className="tabular whitespace-nowrap">{c.callTime ?? "—"}</TD>
                  <TD>{c.crewMember.name}</TD>
                  <TD>{c.role}</TD>
                  <TD className="text-secondary">{c.reportTo ?? "—"}</TD>
                  <TD className="tabular">{c.crewMember.phone ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState
            title="Nobody confirmed for this day"
            description="Confirmed crew booked on the day show here."
          />
        )}
      </Section>
    </>
  );
}
