"use client";

import type { RefObject } from "react";
import type { FormState } from "@/server/http/action-result";
import { Alert } from "./page";

/** The error summary at the top of a form, focused when a submission fails. */
export function FormAlert({
  state,
  alertRef,
  title,
  success,
}: {
  state: FormState;
  alertRef: RefObject<HTMLDivElement | null>;
  title: string;
  /** Shown after a successful submission, for forms that stay on the page. */
  success?: string;
}) {
  if (state.status === "success" && (success || state.message)) {
    return <Alert tone="success" title={state.message ?? success!} />;
  }
  if (state.status !== "error") return null;
  return (
    <div ref={alertRef} tabIndex={-1} className="outline-none">
      <Alert tone="danger" title={title}>
        {state.message}
      </Alert>
    </div>
  );
}
