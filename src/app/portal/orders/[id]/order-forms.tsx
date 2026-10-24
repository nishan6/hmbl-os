"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Alert } from "@/components/ui/page";
import { useForm } from "@/components/ui/use-form";
import { answerOrderAction } from "../../actions";

export function AnswerForm({ orderId, revision }: { orderId: string; revision: number }) {
  const f = useForm(answerOrderAction.bind(null, orderId, revision));
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="Your answer wasn't recorded" />
      <Field
        label="Note"
        description="Needed if you decline: say why, or what would work."
        errors={f.errors("note")}
      >
        {(p) => <Textarea name="note" rows={3} defaultValue={f.value("note")} {...p} />}
      </Field>
      <Button type="submit" name="answer" value="CONFIRMED" variant="primary" disabled={f.pending}>
        Confirm this order
      </Button>
      <Button type="submit" name="answer" value="DECLINED" variant="secondary" disabled={f.pending}>
        Decline it
      </Button>
    </form>
  );
}

type Result = {
  status: "idle" | "success" | "error";
  message?: string;
  fields?: Record<string, string[]>;
};

/** Sends the invoice file as the raw request body, with its details in the query string. */
export function InvoiceUploadForm({ orderId, currency }: { orderId: string; currency: string }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>({ status: "idle" });

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const file = data.get("file");
    if (!(file instanceof File) || !file.name) {
      setResult({
        status: "error",
        message: "Choose your invoice file.",
        fields: { file: ["Choose a file"] },
      });
      return;
    }
    const query = new URLSearchParams({
      orderId,
      vendorInvoiceNumber: String(data.get("vendorInvoiceNumber") ?? ""),
      invoiceDate: String(data.get("invoiceDate") ?? ""),
      total: String(data.get("total") ?? ""),
      note: String(data.get("note") ?? ""),
      fileName: file.name,
    });
    setBusy(true);
    setResult({ status: "idle" });
    try {
      const response = await fetch(`/api/uploads/portal-invoices?${query}`, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (response.status === 201) {
        setResult({
          status: "success",
          message: `Uploaded invoice ${query.get("vendorInvoiceNumber")}`,
        });
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
        <Alert tone="danger" title="Your invoice wasn't uploaded">
          {result.message}
        </Alert>
      ) : result.status === "success" ? (
        <Alert tone="success" title={result.message ?? "Uploaded"} />
      ) : null}
      <Field label="Your invoice number" required errors={errors("vendorInvoiceNumber")}>
        {(p) => <Input name="vendorInvoiceNumber" {...p} />}
      </Field>
      <Field label="Invoice date" required errors={errors("invoiceDate")}>
        {(p) => <Input name="invoiceDate" type="date" {...p} />}
      </Field>
      <Field label={`Total with tax (${currency})`} required errors={errors("total")}>
        {(p) => <Input name="total" inputMode="decimal" className="tabular" {...p} />}
      </Field>
      <Field label="Note" errors={errors("note")}>
        {(p) => <Textarea name="note" rows={2} {...p} />}
      </Field>
      <Field
        label="Invoice file"
        required
        description="A PDF or a photo of it."
        errors={errors("file")}
      >
        {(p) => <Input name="file" type="file" accept=".pdf,image/*" {...p} />}
      </Field>
      <Button type="submit" variant="primary" disabled={busy}>
        <Upload aria-hidden />
        {busy ? "Uploading…" : "Upload invoice"}
      </Button>
    </form>
  );
}
