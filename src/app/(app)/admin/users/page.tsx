import { notFound } from "next/navigation";
import { requireActorOrRedirect } from "@/server/auth/session";
import { can } from "@/server/permissions/authorize";
import { listUsers } from "@/server/users/service";
import { PageHeader } from "@/components/ui/page";
import { StatusBadge, Tag } from "@/components/ui/status";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata = { title: "Users" };

export default async function UsersPage() {
  const actor = await requireActorOrRedirect();
  if (!can(actor, "users.view")) notFound();
  const users = await listUsers(actor);

  return (
    <>
      <PageHeader
        title="Users"
        description="Everyone who can sign in, and the roles they hold. Roles can be limited to one legal entity."
        breadcrumbs={[{ label: "Administration" }, { label: "Users" }]}
      />
      <Table>
        <THead>
          <tr>
            <TH>Name</TH>
            <TH>Email</TH>
            <TH>Roles</TH>
            <TH>Status</TH>
          </tr>
        </THead>
        <TBody>
          {users.map((u) => (
            <TR key={u.id}>
              <TD className="font-medium">{u.name}</TD>
              <TD className="text-secondary">{u.email}</TD>
              <TD>
                <span className="flex flex-wrap gap-1">
                  {u.roles.length
                    ? u.roles.map((r, i) => (
                        <Tag key={i}>
                          {r.role.name}
                          {r.legalEntity ? ` · ${r.legalEntity.code}` : ""}
                        </Tag>
                      ))
                    : "—"}
                </span>
              </TD>
              <TD>
                <StatusBadge status={u.status === "ACTIVE" ? "active" : "disabled"} />
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </>
  );
}
