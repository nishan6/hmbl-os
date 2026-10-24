import Link from "next/link";
import { listMyBookings } from "@/server/portal/freelancer";
import { formatDate } from "@/lib/format";
import { EmptyState, PageHeader } from "@/components/ui/page";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { requirePortal } from "../_lib/guard";
import { BookingStatus } from "./status";

export const metadata = { title: "Bookings" };

export default async function PortalBookingsPage() {
  const actor = await requirePortal("FREELANCER", "work.view");
  const bookings = await listMyBookings(actor);
  return (
    <>
      <PageHeader
        title="Bookings"
        description="Work HMBL has proposed or booked you for. Open one for call details, to answer it or to record your days."
      />
      {bookings.length ? (
        <Table>
          <THead>
            <tr>
              <TH>Role</TH>
              <TH>Project</TH>
              <TH>Dates</TH>
              <TH>Status</TH>
            </tr>
          </THead>
          <TBody>
            {bookings.map((b) => (
              <TR key={b.id}>
                <TD>
                  <Link href={`/portal/bookings/${b.id}`} className="text-accent hover:underline">
                    {b.role}
                  </Link>
                </TD>
                <TD className="text-secondary">
                  {b.project.name}
                  <p className="text-muted text-xs">{b.project.venue ?? ""}</p>
                </TD>
                <TD className="text-secondary whitespace-nowrap">
                  {formatDate(b.startDate, "UTC")}
                  {+b.endDate !== +b.startDate ? ` – ${formatDate(b.endDate, "UTC")}` : ""}
                </TD>
                <TD>
                  <BookingStatus status={b.status} answered={b.portalResponse?.answer} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      ) : (
        <EmptyState title="No bookings yet" />
      )}
    </>
  );
}
