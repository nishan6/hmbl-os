import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { DASHBOARDS, METRICS, type Dashboard } from "@/lib/metrics";
import { Section } from "@/components/ui/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ReportHeader } from "../_components/report-header";

export const metadata = { title: "Metric definitions" };

export default async function DefinitionsPage() {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "reports.view")) notFound();
  const metrics = Object.values(METRICS);
  return (
    <>
      <ReportHeader
        title="Definitions"
        current="definitions"
        description="What every dashboard figure counts, and the records it comes from."
      />
      {(Object.keys(DASHBOARDS) as Dashboard[]).map((key) => (
        <Section key={key} title={`${DASHBOARDS[key].label} dashboard`}>
          <Table dense>
            <THead>
              <tr>
                <TH>Figure</TH>
                <TH>Definition</TH>
                <TH>Source</TH>
              </tr>
            </THead>
            <TBody>
              {metrics
                .filter((m) => m.dashboard === key)
                .map((m) => (
                  <TR key={m.label}>
                    <TD className="text-text align-top font-medium">{m.label}</TD>
                    <TD className="text-secondary align-top">{m.definition}</TD>
                    <TD className="text-secondary align-top">{m.source}</TD>
                  </TR>
                ))}
            </TBody>
          </Table>
        </Section>
      ))}
    </>
  );
}
