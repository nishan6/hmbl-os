import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { getLegalEntity } from "@/server/organisation/service";
import { listNumberingSchemes } from "@/server/numbering/service";
import { DOCUMENT_TYPES, type DocumentType } from "@/server/numbering/document-types";
import { NotFoundError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { Alert, DetailList, PageHeader, Section } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata = { title: "Legal entity" };

export default async function EntityPage({
  params,
  searchParams,
}: PageProps<"/admin/organisation/entities/[id]">) {
  const [{ id }, { created }] = await Promise.all([params, searchParams]);
  const actor = await requireActorOrRedirect();
  const entity = await getLegalEntity(actor, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const schemes = (await listNumberingSchemes(actor)).filter((s) => s.legalEntityId === id);
  const address = [
    entity.addressLine1,
    entity.addressLine2,
    entity.city,
    entity.region,
    entity.postalCode,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <>
      <PageHeader
        title={entity.legalName}
        description={
          <span className="flex items-center gap-2">
            {entity.code}
            <StatusBadge status={entity.status === "ACTIVE" ? "active" : "archived"} />
            {entity.isDemo ? <Tag tone="warning">Demo</Tag> : null}
          </span>
        }
        breadcrumbs={[
          { label: "Administration" },
          { label: "Organisation", href: "/admin/organisation" },
          { label: entity.code },
        ]}
      />
      {created ? (
        <div className="mb-6">
          <Alert tone="success" title="Legal entity created">
            Add its tax registrations and number formats next.
          </Alert>
        </div>
      ) : null}

      <Section title="Details">
        <DetailList
          items={[
            { label: "Trading name", value: entity.tradingName },
            { label: "Country", value: entity.countryCode },
            { label: "Base currency", value: entity.baseCurrency },
            { label: "Time zone", value: entity.timezone },
            { label: "Registered address", value: address || null },
          ]}
        />
      </Section>

      <Section title="Tax registrations">
        {entity.taxRegistrations.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Type</TH>
                <TH>Number</TH>
                <TH>Region</TH>
                <TH>Valid from</TH>
              </tr>
            </THead>
            <TBody>
              {entity.taxRegistrations.map((t) => (
                <TR key={t.id}>
                  <TD className="font-medium">{t.type}</TD>
                  <TD className="font-mono">{t.value}</TD>
                  <TD>{t.region ?? "—"}</TD>
                  <TD>{t.validFrom ? formatDate(t.validFrom, entity.timezone) : "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-secondary text-base">None recorded.</p>
        )}
      </Section>

      <Section title="Number formats">
        {schemes.length ? (
          <Table dense>
            <THead>
              <tr>
                <TH>Document</TH>
                <TH>Pattern</TH>
                <TH>Resets</TH>
              </tr>
            </THead>
            <TBody>
              {schemes.map((s) => (
                <TR key={s.id}>
                  <TD>{DOCUMENT_TYPES[s.documentType as DocumentType]?.label ?? s.documentType}</TD>
                  <TD className="font-mono">{s.pattern}</TD>
                  <TD className="text-secondary">
                    {s.resetPolicy.toLowerCase().replace("_", " ")}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <p className="text-secondary text-base">No number formats yet.</p>
        )}
      </Section>
    </>
  );
}
