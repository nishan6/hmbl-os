import Link from "next/link";
import { can, type Actor } from "@/server/permissions/authorize";
import { listProjects, type ProjectListOptions } from "@/server/projects/projects";
import { formatMoney } from "@/lib/format";
import { Section } from "@/components/ui/page";
import { StatusBadge } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { PROJECT_STATUS } from "./status";

/** Projects for a client or an opportunity, for their pages. Hidden when there are none. */
export async function ProjectsSection({
  actor,
  filter,
}: {
  actor: Actor;
  filter: ProjectListOptions;
}) {
  if (!can(actor, "projects.view")) return null;
  const projects = await listProjects(actor, filter);
  if (!projects.length) return null;
  return (
    <Section title="Projects">
      <Table dense>
        <THead>
          <tr>
            <TH>Project</TH>
            <TH>Entity</TH>
            <TH>Status</TH>
            <TH align="right">Contract value</TH>
          </tr>
        </THead>
        <TBody>
          {projects.map((p) => (
            <TR key={p.id}>
              <TD className="font-medium">
                <Link href={`/projects/${p.id}`} className="text-accent hover:underline">
                  <span className="tabular">{p.number}</span> · {p.name}
                </Link>
              </TD>
              <TD className="text-secondary">{p.legalEntity.code}</TD>
              <TD>
                <StatusBadge status={PROJECT_STATUS[p.status]} />
              </TD>
              <TD align="right">{formatMoney(p.contractValueMinor, p.currency)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Section>
  );
}
