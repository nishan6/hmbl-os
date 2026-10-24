"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";

type Step = "password" | "code" | "backup";

export function SignInForm({ next, email }: { next: string; email?: string }) {
  const [step, setStep] = useState<Step>("password");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // A full load, so nothing the router cached while signed out is reused.
  const finish = () => window.location.assign(next);

  async function onPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { data, error } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    setPending(false);
    if (error) {
      // One message for every failure, so the form doesn't reveal which accounts exist.
      setError(
        error.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : "That email and password don't match an active account.",
      );
      return;
    }
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      setStep("code");
      return;
    }
    finish();
  }

  async function onCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const code = String(form.get("code")).trim();
    const trustDevice = form.get("trustDevice") === "on";
    setPending(true);
    setError(null);
    const { error } =
      step === "backup"
        ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
        : await authClient.twoFactor.verifyTotp({ code: code.replace(/\s/g, ""), trustDevice });
    setPending(false);
    if (error) {
      setError(
        error.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : error.status === 401 && /cookie|expired/i.test(error.message ?? "")
            ? "This sign-in took too long. Start again with your password."
            : "That code didn't work. Try the newest code from your app.",
      );
      return;
    }
    finish();
  }

  if (step === "password") {
    return (
      <form onSubmit={onPassword} className="mt-6 flex flex-col gap-4" noValidate>
        <Field label="Email">
          {(props) => (
            <Input
              {...props}
              name="email"
              type="email"
              autoComplete="username"
              defaultValue={email}
              required
            />
          )}
        </Field>
        <Field label="Password">
          {(props) => (
            <Input
              {...props}
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          )}
        </Field>
        {error ? <Alert tone="danger" title={error} /> : null}
        <Button type="submit" variant="primary" size="lg" disabled={pending} className="w-full">
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    );
  }

  return (
    <form key={step} onSubmit={onCode} className="mt-6 flex flex-col gap-4" noValidate>
      <p className="text-secondary text-base">
        {step === "code"
          ? "Enter the 6-digit code from your authenticator app."
          : "Enter one of the backup codes you saved. Each works once."}
      </p>
      <Field label={step === "code" ? "6-digit code" : "Backup code"}>
        {(props) => (
          <Input
            {...props}
            name="code"
            autoFocus
            autoComplete="one-time-code"
            inputMode={step === "code" ? "numeric" : "text"}
            required
            className="font-mono tracking-widest"
          />
        )}
      </Field>
      <label className="text-secondary flex items-center gap-2 text-sm">
        <input type="checkbox" name="trustDevice" className="accent-accent size-4" />
        Don&apos;t ask again on this device for 30 days
      </label>
      {error ? <Alert tone="danger" title={error} /> : null}
      <Button type="submit" variant="primary" size="lg" disabled={pending} className="w-full">
        {pending ? "Checking…" : "Continue"}
      </Button>
      <Button
        variant="quiet"
        size="sm"
        onClick={() => {
          setError(null);
          setStep(step === "code" ? "backup" : "code");
        }}
      >
        {step === "code" ? "Use a backup code instead" : "Use my authenticator app instead"}
      </Button>
    </form>
  );
}
