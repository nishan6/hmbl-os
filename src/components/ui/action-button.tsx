"use client";

import { useActionState } from "react";
import { Button, type ButtonProps } from "./button";

type State = { status: "idle" | "success" | "error"; message?: string };

/**
 * A one-click server action (archive, make default, submit…) with hidden
 * fields. Shows the server's message beside the button if it fails.
 * `confirm` asks before running, for anything hard to undo.
 */
export function ActionButton({
  action,
  fields,
  children,
  pendingLabel,
  confirm,
  variant = "quiet",
  size = "sm",
}: {
  action: (state: State, formData: FormData) => Promise<State>;
  fields: Record<string, string>;
  children: React.ReactNode;
  pendingLabel?: string;
  confirm?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const [state, run, pending] = useActionState<State, FormData>(action, { status: "idle" });
  return (
    <form
      action={run}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
      className="inline-flex items-center gap-2"
    >
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <Button type="submit" variant={variant} size={size} disabled={pending}>
        {pending && pendingLabel ? pendingLabel : children}
      </Button>
      {state.status === "error" ? (
        <span role="alert" className="text-danger text-xs">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
