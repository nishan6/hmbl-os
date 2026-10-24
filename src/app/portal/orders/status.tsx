import { StatusBadge } from "@/components/ui/status";

/** An order's state as the vendor reads it, with their own answer. */
export function OrderStatus({
  state,
  answer,
}: {
  state: "open" | "amending" | "closed" | "cancelled";
  answer: { answer: "CONFIRMED" | "DECLINED" } | null;
}) {
  if (state === "cancelled") return <StatusBadge status="cancelled" />;
  if (state === "closed") return <StatusBadge status="closed" />;
  if (state === "amending") return <StatusBadge status="amending" label="Being changed by HMBL" />;
  if (answer?.answer === "CONFIRMED") return <StatusBadge status="confirmed" />;
  if (answer?.answer === "DECLINED") return <StatusBadge status="declined" />;
  return <StatusBadge status="pending_approval" label="Waiting for your answer" />;
}
