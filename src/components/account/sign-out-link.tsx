"use client";

import { authClient } from "@/lib/auth-client";
import { clearOfflineData } from "@/lib/offline/store";
import { Button } from "@/components/ui/button";

export function SignOutLink() {
  return (
    <Button
      variant="quiet"
      size="sm"
      onClick={async () => {
        // Show packs kept for offline use go with the session (docs/offline.md).
        await clearOfflineData();
        await authClient.signOut();
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/sign-in");
      }}
    >
      Sign out
    </Button>
  );
}
