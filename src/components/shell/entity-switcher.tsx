"use client";

import { useTransition } from "react";
import { Building2 } from "lucide-react";
import { setEntityContext } from "@/app/(app)/actions";
import type { EntityOption } from "@/server/shell/entity-context";

/** Which legal entity the user is working in. Shown only when there's a choice. */
export function EntitySwitcher({
  entities,
  selectedId,
}: {
  entities: EntityOption[];
  selectedId: string | null;
}) {
  const [pending, startTransition] = useTransition();
  if (entities.length === 0) return null;
  if (entities.length === 1) {
    return (
      <span className="text-secondary flex items-center gap-1.5 text-sm">
        <Building2 className="size-4" aria-hidden />
        {entities[0]!.code}
      </span>
    );
  }
  return (
    <label className="text-secondary flex items-center gap-1.5 text-sm">
      <Building2 className="size-4" aria-hidden />
      <span className="sr-only">Legal entity</span>
      <select
        value={selectedId ?? "all"}
        disabled={pending}
        onChange={(e) => startTransition(() => setEntityContext(e.target.value))}
        className="h-control-sm text-text hover:border-border max-w-48 rounded-md border border-transparent bg-transparent pr-6 pl-1 text-sm"
      >
        <option value="all">All entities</option>
        {entities.map((e) => (
          <option key={e.id} value={e.id}>
            {e.code}
            {e.isDemo ? " (demo)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
