"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";
import { BackupCodes } from "./backup-codes";

type Step =
  | { name: "password" }
  | { name: "scan"; totpURI: string; backupCodes: string[] }
  | { name: "codes"; backupCodes: string[] };

/** The secret an app would type in by hand, spaced in fours for reading. */
function manualKey(totpURI: string) {
  const secret = new URL(totpURI).searchParams.get("secret") ?? "";
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

/**
 * Turns on two-factor: confirm the password, scan the QR code with an
 * authenticator app, prove it works with one code, then save backup codes.
 * `doneHref` is loaded in full afterwards so the server sees the new state.
 */
export function TwoFactorSetup({ doneHref }: { doneHref: string }) {
  const [step, setStep] = useState<Step>({ name: "password" });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (step.name !== "scan") return;
    QRCode.toDataURL(step.totpURI, { margin: 1, width: 200 }).then(setQr, () => setQr(null));
  }, [step]);

  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password"));
    setPending(true);
    setError(null);
    const { data, error } = await authClient.twoFactor.enable({ password });
    setPending(false);
    if (error || !data || !("totpURI" in data) || !data.totpURI) {
      setError(
        error?.status === 429 ? "Too many attempts. Wait a minute." : "That password is not right.",
      );
      return;
    }
    setStep({ name: "scan", totpURI: data.totpURI, backupCodes: data.backupCodes });
  }

  async function confirm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step.name !== "scan") return;
    const code = String(new FormData(event.currentTarget).get("code")).replace(/\s/g, "");
    setPending(true);
    setError(null);
    const { error } = await authClient.twoFactor.verifyTotp({ code });
    setPending(false);
    if (error) {
      setError(
        "That code didn't match. Check the time on your phone is set automatically, then try the newest code.",
      );
      return;
    }
    setStep({ name: "codes", backupCodes: step.backupCodes });
  }

  return (
    <div className="max-w-form flex flex-col gap-4">
      {error ? <Alert tone="danger" title={error} /> : null}

      {step.name === "password" ? (
        <form onSubmit={start} className="flex flex-col gap-4" noValidate>
          <p className="text-secondary text-base">
            You&apos;ll need a free authenticator app on your phone, such as Google Authenticator,
            Microsoft Authenticator or 1Password. Start by confirming your password.
          </p>
          <Field label="Current password">
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
          <div>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Checking…" : "Continue"}
            </Button>
          </div>
        </form>
      ) : null}

      {step.name === "scan" ? (
        <form onSubmit={confirm} className="flex flex-col gap-4" noValidate>
          <ol className="text-secondary flex list-decimal flex-col gap-1 pl-5 text-base">
            <li>Open your authenticator app and add an account.</li>
            <li>Scan this QR code, or type the key below.</li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-6">
            {qr ? (
              // A data URL from the qrcode library; next/image adds nothing here.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qr}
                width={200}
                height={200}
                alt="QR code for your authenticator app"
                className="rounded-md bg-white p-2"
              />
            ) : null}
            <div className="min-w-0">
              <p className="text-muted text-xs">Key for typing in by hand</p>
              <p data-testid="totp-key" className="text-text mt-1 font-mono text-sm break-all">
                {manualKey(step.totpURI)}
              </p>
            </div>
          </div>
          <Field label="6-digit code">
            {(p) => (
              <Input
                {...p}
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                required
                className="max-w-40 font-mono tracking-widest"
              />
            )}
          </Field>
          <div>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? "Checking…" : "Turn on two-factor"}
            </Button>
          </div>
        </form>
      ) : null}

      {step.name === "codes" ? (
        <BackupCodes codes={step.backupCodes} onDone={() => window.location.assign(doneHref)} />
      ) : null}
    </div>
  );
}
