"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/page";

/** One-time display of backup codes. They can't be shown again after this. */
export function BackupCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <Alert tone="warning" title="Save these backup codes now">
        Each one signs you in once if you lose your phone. Keep them somewhere safe, such as a
        password manager. They won&apos;t be shown again.
      </Alert>
      <ol
        aria-label="Backup codes"
        className="bg-sunken grid grid-cols-2 gap-x-6 gap-y-1 rounded-md p-4 font-mono text-sm"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={async () => {
            await navigator.clipboard.writeText(codes.join("\n"));
            setCopied(true);
          }}
        >
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? "Copied" : "Copy codes"}
        </Button>
        <Button variant="primary" onClick={onDone}>
          I&apos;ve saved them
        </Button>
      </div>
    </div>
  );
}
