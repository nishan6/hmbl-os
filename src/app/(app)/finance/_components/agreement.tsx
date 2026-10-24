import { CircleCheck, TriangleAlert } from "lucide-react";

/** Says whether a report agrees with its ledger account. */
export function Agreement({ difference, label }: { difference: bigint; label: React.ReactNode }) {
  return (
    <p className="mt-3 flex items-center gap-2 text-sm" role="status">
      {difference === 0n ? (
        <>
          <CircleCheck aria-hidden className="text-success size-4" />
          {label}
        </>
      ) : (
        <>
          <TriangleAlert aria-hidden className="text-danger size-4" />
          {label}
        </>
      )}
    </p>
  );
}
