"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/page";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The server logged the detail; the browser only gets the digest.
    console.error(error.digest ?? "client error");
  }, [error]);

  return (
    <EmptyState
      titleAs="h1"
      icon={TriangleAlert}
      title="Something went wrong"
      description={
        error.digest
          ? `Nothing was saved. If it keeps happening, quote reference ${error.digest}.`
          : "Nothing was saved. Try again, and if it keeps happening tell your administrator."
      }
      action={
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
      }
    />
  );
}
