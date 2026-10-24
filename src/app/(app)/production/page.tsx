import Link from "next/link";
import { notFound } from "next/navigation";
import { CloudDownload, Theater } from "lucide-react";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { listShows } from "@/server/production/workspace";
import { cn } from "@/lib/cn";
import { buttonClasses } from "@/components/ui/button";
import { formatDate } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { PROJECT_STATUS } from "../projects/_components/status";
import { UPDATE_STATUS } from "./_components/show-tabs";

export const metadata = { title: "Production" };

export default async function ProductionPage({ searchParams }: PageProps<"/production">) {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "production.view")) notFound();
  const past = (await searchParams).when === "past";
  const shows = await listShows(actor, { past });
  const dates = (s: (typeof shows)[number]) =>
    s.first && s.last && s.first.getTime() !== s.last.getTime()
      ? `${formatDate(s.first, "UTC")} – ${formatDate(s.last, "UTC")}`
      : s.first
        ? formatDate(s.first, "UTC")
        : "—";

  return (
    <>
      <PageHeader
        title="Production"
        description="Show days: what the people at the venue need to know, and what is happening now."
        actions={
          // A full page load, not a client navigation: the field app runs
          // on its own so it can open offline (docs/offline.md).
          <a href="/field" className={buttonClasses("secondary")}>
            <CloudDownload aria-hidden className="size-4" />
            Field app (works offline)
          </a>
        }
      />
      <nav aria-label="Shows" className="border-separator mb-6 flex gap-4 border-b">
        {[
          { href: "/production", label: "Today and coming up", current: !past },
          { href: "/production?when=past", label: "Past", current: past },
        ].map((t) => (
          <Link
            key={t.href}
            href={t.href}
            aria-current={t.current ? "page" : undefined}
            className={cn(
              "text-secondary hover:text-text -mb-px border-b-2 border-transparent pb-2 text-base",
              "aria-[current=page]:border-accent aria-[current=page]:text-text aria-[current=page]:font-medium",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {shows.length ? (
        <Table>
          <THead>
            <tr>
              <TH>Show</TH>
              <TH>Dates</TH>
              <TH>Venue</TH>
              <TH>Project</TH>
              <TH>Latest update</TH>
            </tr>
          </THead>
          <TBody>
            {shows.map((s) => (
              <TR key={s.id}>
                <TD>
                  <Link href={`/production/${s.id}`} className="text-accent hover:underline">
                    {s.name}
                  </Link>
                  <span className="text-secondary block text-xs">
                    {s.number} · {s.entity}
                    {s.client ? ` · ${s.client}` : ""}
                  </span>
                </TD>
                <TD className="tabular whitespace-nowrap">
                  {dates(s)}
                  {s.today ? (
                    <Tag tone="accent" className="ml-2">
                      Today
                    </Tag>
                  ) : null}
                </TD>
                <TD>{s.venue ?? "—"}</TD>
                <TD>
                  <StatusBadge status={PROJECT_STATUS[s.status]} />
                  {s.isDemo ? (
                    <Tag tone="warning" className="ml-2">
                      Demo
                    </Tag>
                  ) : null}
                </TD>
                <TD>
                  {s.latest ? (
                    <span className="flex items-center gap-2">
                      <StatusBadge status={UPDATE_STATUS[s.latest.status]} />
                      <span className="text-secondary line-clamp-1 text-sm">
                        {s.latest.message}
                      </span>
                    </span>
                  ) : (
                    <span className="text-muted text-sm">None yet</span>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState
          icon={Theater}
          title={past ? "No past shows" : "No shows coming up"}
          description="Approved projects with show dates on their schedule appear here."
        />
      )}
    </>
  );
}
