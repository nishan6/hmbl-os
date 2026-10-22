import { Skeleton } from "@/components/ui/page";

export default function AppLoading() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-6 w-64" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-row w-full" />
        ))}
      </div>
    </div>
  );
}
