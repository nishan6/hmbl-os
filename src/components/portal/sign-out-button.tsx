"use client";

import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  return (
    <Button
      type="button"
      variant="quiet"
      onClick={async () => {
        await authClient.signOut();
        // A full load drops every page the router cached while signed in.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/sign-in");
      }}
    >
      <LogOut aria-hidden />
      Sign out
    </Button>
  );
}
