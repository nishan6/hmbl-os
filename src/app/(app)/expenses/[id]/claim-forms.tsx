"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Alert } from "@/components/ui/page";
import { useForm } from "@/components/ui/use-form";
import { formatMoney } from "@/lib/format";
import type { FormState } from "@/server/http/action-result";

type Action = (state: FormState, formData: FormData) => Promise<FormState>;

/** Sends a submitted claim back to the claimant with a reason. */
export function RejectClaimForm({ action }: { action: Action }) {
  const f = useForm(action, {});
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The claim wasn't sent back" />
      <Field label="What needs fixing" required errors={f.errors("reason")}>
        {(p) => <Input name="reason" defaultValue={f.value("reason")} {...p} />}
      </Field>
      <div>
        <Button type="submit" disabled={f.pending}>
          {f.pending ? "Sending back…" : "Send back to the claimant"}
        </Button>
      </div>
    </form>
  );
}

/** Settles what is left on a claim from an advance, or by paying it from an account. */
export function SettleClaimForm({
  action,
  advances,
  accounts,
  currency,
  outstanding,
  defaultDate,
}: {
  action: Action;
  advances: { id: string; number: string; purpose: string; leftMinor: bigint }[];
  accounts: { id: string; code: string; name: string }[];
  currency: string;
  outstanding: string;
  defaultDate: string;
}) {
  const f = useForm(action, {
    date: defaultDate,
    amount: outstanding,
    source: advances[0] ? `advance:${advances[0].id}` : "",
  });
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The claim wasn't settled" />
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr_10rem]">
        <Field label="Date" required errors={f.errors("date")}>
          {(p) => <Input type="date" name="date" defaultValue={f.value("date")} {...p} />}
        </Field>
        <Field
          label="Settle from"
          required
          errors={f.errors("advanceId") ?? f.errors("paidFromId")}
        >
          {(p) => (
            <Select name="source" defaultValue={f.value("source")} {...p}>
              <option value="">Choose…</option>
              {advances.length ? (
                <optgroup label="Set against an advance">
                  {advances.map((a) => (
                    <option key={a.id} value={`advance:${a.id}`}>
                      {a.number} · {a.purpose} ({formatMoney(a.leftMinor, currency)} left)
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <optgroup label="Pay from">
                {accounts.map((a) => (
                  <option key={a.id} value={`account:${a.id}`}>
                    {a.code} · {a.name}
                  </option>
                ))}
              </optgroup>
            </Select>
          )}
        </Field>
        <Field label={`Amount (${currency})`} required errors={f.errors("amount")}>
          {(p) => (
            <Input
              name="amount"
              inputMode="decimal"
              className="tabular text-right"
              defaultValue={f.value("amount")}
              {...p}
            />
          )}
        </Field>
      </div>
      <Field
        label="Reference"
        description="UTR or cheque number when paid"
        errors={f.errors("reference")}
      >
        {(p) => (
          <Input name="reference" defaultValue={f.value("reference")} className="max-w-xs" {...p} />
        )}
      </Field>
      <div>
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Settling…" : "Settle"}
        </Button>
      </div>
    </form>
  );
}

/** Uploads a receipt as the raw request body, against one of the claim's expenses. */
export function ReceiptUploadForm({
  claimId,
  lines,
}: {
  claimId: string;
  lines: { id: string; label: string }[];
}) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    status: "idle" | "success" | "error";
    message?: string;
    fields?: Record<string, string[]>;
  }>({ status: "idle" });

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const file = data.get("file");
    if (!(file instanceof File) || !file.name) {
      setResult({
        status: "error",
        message: "Choose a file.",
        fields: { file: ["Choose a file"] },
      });
      return;
    }
    const query = new URLSearchParams({
      fileName: file.name,
      lineId: String(data.get("lineId") ?? ""),
    });
    setBusy(true);
    setResult({ status: "idle" });
    try {
      const response = await fetch(`/api/uploads/expense-claims/${claimId}/receipts?${query}`, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (response.status === 201) {
        setResult({ status: "success", message: `Attached ${file.name}` });
        form.current?.reset();
        router.refresh();
        return;
      }
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        fieldErrors?: Record<string, string[]>;
      };
      setResult({
        status: "error",
        message: body.error ?? "The upload failed. Please try again.",
        fields: body.fieldErrors,
      });
    } catch {
      setResult({ status: "error", message: "The upload was interrupted. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  const errors = (name: string) => result.fields?.[name];
  return (
    <form ref={form} onSubmit={submit} className="flex flex-col gap-3" noValidate>
      {result.status === "error" ? (
        <Alert tone="danger" title="The receipt wasn't attached">
          {result.message}
        </Alert>
      ) : result.status === "success" ? (
        <Alert tone="success" title={result.message ?? "Attached"} />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="For expense" errors={errors("lineId")}>
          {(p) => (
            <Select name="lineId" defaultValue={lines[0]?.id ?? ""} {...p}>
              <option value="">The whole claim</option>
              {lines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Receipt" required description="A photo or PDF" errors={errors("file")}>
          {(p) => <Input name="file" type="file" accept="image/*,application/pdf" {...p} />}
        </Field>
      </div>
      <div>
        <Button type="submit" disabled={busy}>
          <Upload aria-hidden />
          {busy ? "Uploading…" : "Attach receipt"}
        </Button>
      </div>
    </form>
  );
}
