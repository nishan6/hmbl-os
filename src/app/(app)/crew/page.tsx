import Link from "next/link";
import { notFound } from "next/navigation";
import { HardHat, Plus, Search } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { crewSkills, listCrew, CREW_KINDS } from "@/server/crew/members";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata = { title: "Crew" };

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function CrewPage({ searchParams }: PageProps<"/crew">) {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "crew.view")) notFound();
  const params = await searchParams;
  const q = str(params.q);
  const skill = str(params.skill);
  const kind = params.kind === "EMPLOYEE" || params.kind === "FREELANCER" ? params.kind : undefined;
  const archived = params.archived === "1";
  const [crew, skills] = await Promise.all([
    listCrew(actor, { search: q, skill: skill || undefined, kind, includeArchived: archived }),
    crewSkills(actor),
  ]);
  const filtered = Boolean(q || skill || kind || archived);

  return (
    <>
      <PageHeader
        title="Crew"
        description="Staff and freelancers HMBL puts on projects. Shared by every legal entity."
        actions={
          can(actor, "crew.create") ? (
            <Button asChild variant="primary">
              <Link href="/crew/new">
                <Plus aria-hidden />
                New crew member
              </Link>
            </Button>
          ) : null
        }
      />

      <form role="search" className="mb-4 flex flex-wrap items-end gap-2" action="/crew">
        <label className="sr-only" htmlFor="crew-search">
          Search crew
        </label>
        <Input
          id="crew-search"
          name="q"
          defaultValue={q}
          placeholder="Name, phone, email or city"
          className="max-w-xs"
        />
        <label className="sr-only" htmlFor="crew-skill">
          Skill
        </label>
        <Select id="crew-skill" name="skill" defaultValue={skill} className="w-48">
          <option value="">Any skill</option>
          {skills.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <label className="sr-only" htmlFor="crew-kind">
          Staff or freelancer
        </label>
        <Select id="crew-kind" name="kind" defaultValue={kind ?? ""} className="w-40">
          <option value="">Staff and freelancers</option>
          {Object.entries(CREW_KINDS).map(([value, label]) => (
            <option key={value} value={value}>
              {label} only
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

      {crew.length ? (
        <Table>
          <THead>
            <tr>
              <TH>Name</TH>
              <TH>Works as</TH>
              <TH>Roles and skills</TH>
              <TH>Based in</TH>
              <TH>Phone</TH>
              <TH>Status</TH>
            </tr>
          </THead>
          <TBody>
            {crew.map((c) => (
              <TR key={c.id}>
                <TD className="font-medium">
                  <span className="flex items-center gap-2">
                    <Link href={`/crew/${c.id}`} className="text-accent hover:underline">
                      {c.name}
                    </Link>
                    {c.isDemo ? <Tag tone="warning">Demo</Tag> : null}
                  </span>
                </TD>
                <TD>{CREW_KINDS[c.kind]}</TD>
                <TD className="text-secondary">
                  <span className="flex flex-wrap gap-1">
                    {c.skills.map((s) => (
                      <Tag key={s}>{s}</Tag>
                    ))}
                  </span>
                </TD>
                <TD className="text-secondary">{c.baseCity ?? "—"}</TD>
                <TD className="tabular text-secondary">{c.phone ?? "—"}</TD>
                <TD>
                  <StatusBadge status={c.status === "ACTIVE" ? "active" : "archived"} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState
          icon={HardHat}
          title={filtered ? "No crew match" : "No crew yet"}
          description={
            filtered
              ? "Try another name or skill, or include archived crew."
              : "Add the staff and freelancers you put on shows, with their skills and rates."
          }
        />
      )}
    </>
  );
}
