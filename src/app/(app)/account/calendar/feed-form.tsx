"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Copy, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Alert } from "@/components/ui/page";
import type { FeedState } from "./actions";

/** Makes the calendar link and shows it once, to copy into a calendar app. */
export function FeedForm({
  action,
  replace,
}: {
  action: (state: FeedState, formData: FormData) => Promise<FeedState>;
  replace: boolean;
}) {
  const [state, run, pending] = useActionState<FeedState, FormData>(action, { status: "idle" });
  const alertRef = useRef<HTMLDivElement>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const copied = !!state.link && copiedLink === state.link;
  useEffect(() => {
    if (state.status === "error") alertRef.current?.focus();
  }, [state]);

  return (
    <div className="flex flex-col gap-4">
      {state.status === "success" && state.link ? (
        <Alert tone="success" title="Your calendar link is ready">
          <p className="mb-2">
            Add it to your calendar app as a subscription by URL. It is shown only now. Anyone with
            the link can read the feed, so keep it to yourself.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              readOnly
              value={state.link}
              aria-label="Calendar link"
              className="min-w-0 flex-1 font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(state.link!);
                setCopiedLink(state.link!);
              }}
            >
              <Copy aria-hidden />
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
        </Alert>
      ) : null}
      <form
        action={run}
        onSubmit={(e) => {
          if (
            replace &&
            !window.confirm("Make a new link? The current one stops working straight away.")
          )
            e.preventDefault();
        }}
      >
        <FormAlert state={state} alertRef={alertRef} title="The link wasn't made" />
        <Button type="submit" variant={replace ? "secondary" : "primary"} disabled={pending}>
          <Link2 aria-hidden />
          {pending ? "Making…" : replace ? "Make a new link" : "Make my calendar link"}
        </Button>
      </form>
    </div>
  );
}
