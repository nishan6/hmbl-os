"use client";

import { authClient } from "@/lib/auth-client";
import { clearOfflineData, confirmSignOut } from "@/lib/offline/store";
import { Button } from "@/components/ui/button";

export function SignOutLink() {
  return (
    <Button
      variant="quiet"
      size="sm"
      onClick={async () => {
        // What the field app keeps on this device goes with the session (docs/offline.md).
        if (!(await confirmSignOut())) return;
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
