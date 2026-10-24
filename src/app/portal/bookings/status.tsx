import { StatusBadge } from "@/components/ui/status";

/** A booking's status as the freelancer reads it. */
export function BookingStatus({
  status,
  answered,
}: {
  status: string;
  answered?: "CONFIRMED" | "DECLINED" | null;
}) {
  if (status === "CONFIRMED") return <StatusBadge status="confirmed" />;
  if (status === "DECLINED") return <StatusBadge status="declined" />;
  if (status === "CANCELLED") return <StatusBadge status="cancelled" label="Cancelled by HMBL" />;
  if (answered === "CONFIRMED") {
    return <StatusBadge status="pending_review" label="You said yes; HMBL to confirm" />;
  }
  return <StatusBadge status="proposed" label="Waiting for your answer" />;
}
