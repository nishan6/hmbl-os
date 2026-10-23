"use client";

import { useEffect, useState } from "react";
import type { FormState } from "@/server/http/action-result";

/**
 * Warns before leaving a page with unsaved edits. Returns an onChange handler
 * for the form; a successful save clears the warning.
 */
export function useUnsavedChangesWarning(state: FormState) {
  const [dirty, setDirty] = useState(false);
  const [lastState, setLastState] = useState(state);
  if (state !== lastState) {
    setLastState(state);
    if (state.status === "success") setDirty(false);
  }
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  return () => setDirty(true);
}
