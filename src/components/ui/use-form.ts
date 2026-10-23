"use client";

import { useActionState, useEffect, useRef } from "react";
import type { FormState } from "@/server/http/action-result";

/**
 * Wires a form to a server action that returns FormState. Values come back
 * after an error so nothing typed is lost; after a success the form resets.
 * Put `formKey` on the <form> and `alertRef` on the error summary.
 */
export function useForm(
  action: (state: FormState, formData: FormData) => Promise<FormState>,
  defaults: Record<string, string> = {},
) {
  const [state, run, pending] = useActionState<FormState, FormData>(action, { status: "idle" });
  const alertRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.status === "error") alertRef.current?.focus();
  }, [state]);

  const values = state.status === "error" ? (state.values ?? {}) : {};
  return {
    state,
    action: run,
    pending,
    alertRef,
    // A new key remounts uncontrolled inputs with the right default values.
    formKey: `${state.status}-${state.savedAt ?? JSON.stringify(values)}`,
    value: (name: string) => values[name] ?? defaults[name] ?? "",
    errors: (name: string) => state.fieldErrors?.[name],
  };
}
