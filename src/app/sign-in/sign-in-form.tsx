"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";

export function SignInForm({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const { error } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });
    if (error) {
      setPending(false);
      // One message for every failure, so the form doesn't reveal which accounts exist.
      setError(
        error.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : "That email and password don't match an active account.",
      );
      return;
    }
    // A full load, so nothing the router cached while signed out is reused.
    window.location.assign(next);
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate>
      <Field label="Email">
        {(props) => <Input {...props} name="email" type="email" autoComplete="username" required />}
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
