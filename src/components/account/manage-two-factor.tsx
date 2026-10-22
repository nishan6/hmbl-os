"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { BackupCodes } from "./backup-codes";

type Action = "codes" | "disable";

/** For a user who already has two-factor: new backup codes, or turning it off where allowed. */
export function ManageTwoFactor({ canDisable }: { canDisable: boolean }) {
  const [action, setAction] = useState<Action | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password"));
    setPending(true);
    setError(null);
    if (action === "codes") {
      const { data, error } = await authClient.twoFactor.generateBackupCodes({ password });
      setPending(false);
      if (error || !data) return setError("That password is not right.");
      setCodes(data.backupCodes);
    } else {
      const { error } = await authClient.twoFactor.disable({ password });
      setPending(false);
      if (error) {
        return setError(
          error.status === 403 ? (error.message ?? "Not allowed.") : "That password is not right.",
        );
      }
      window.location.reload();
    }
  }

  if (codes) return <BackupCodes codes={codes} onDone={() => window.location.reload()} />;

  return (
    <div className="max-w-form flex flex-col gap-4">
      {error ? <Alert tone="danger" title={error} /> : null}
      {action ? (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field
            label="Current password"
            description={
              action === "codes"
                ? "Your old backup codes stop working."
                : "You'll sign in with your password only."
            }
          >
            {(p) => (
              <Input
                {...p}
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            )}
          </Field>
          <div className="flex gap-2">
            <Button
              type="submit"
              variant={action === "disable" ? "destructive" : "primary"}
              disabled={pending}
            >
              {action === "codes" ? "Create new backup codes" : "Turn off two-factor"}
            </Button>
            <Button variant="quiet" onClick={() => setAction(null)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setAction("codes")}>New backup codes</Button>
          {canDisable ? (
            <Button variant="quiet" onClick={() => setAction("disable")}>
              Turn off
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
