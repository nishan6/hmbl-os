import { StatusBadge, type StatusKey } from "@/components/ui/status";

const KEY: Record<string, [StatusKey, string]> = {
  ISSUED: ["pending_approval", "Waiting for your answer"],
  ACCEPTED: ["accepted", "Accepted"],
  DECLINED: ["declined", "Declined"],
  SUPERSEDED: ["superseded", "Replaced by a newer version"],
  WITHDRAWN: ["withdrawn", "Withdrawn by HMBL"],
};

/** A quotation version's status as the client reads it. */
export function QuoteStatus({ status, expired }: { status: string; expired?: boolean }) {
  if (expired) return <StatusBadge status="expired" />;
  const [key, label] = KEY[status] ?? ["issued", "Sent"];
  return <StatusBadge status={key} label={label} />;
}
