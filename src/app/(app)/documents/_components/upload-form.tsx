"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Alert } from "@/components/ui/page";

type Result = {
  status: "idle" | "success" | "error";
  message?: string;
  fields?: Record<string, string[]>;
};

/**
 * Sends the file as the raw request body, so any size works and the
 * progress bar is real. The server streams it to disk.
 */
export function UploadForm({
  recordType,
  recordId,
  categories,
  restrictable = false,
  previousVersionId,
  category,
  label = "Upload",
}: {
  recordType: string;
  recordId: string;
  categories: Record<string, string>;
  /** Offers "Restricted" for people who may see restricted documents. */
  restrictable?: boolean;
  previousVersionId?: string;
  /** Fixed for a new version. */
  category?: string;
  label?: string;
}) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const progressId = useId();
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<Result>({ status: "idle" });

  function submit(event: React.FormEvent<HTMLFormElement>) {
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
      recordType,
      recordId,
      restricted: data.get("restricted") === "on" ? "true" : "false",
      category: String(data.get("category") ?? category ?? ""),
      title: String(data.get("title") ?? ""),
      fileName: file.name,
      ...(previousVersionId ? { previousVersionId } : {}),
    });
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/uploads/documents?${query}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      setProgress(null);
      if (xhr.status === 201) {
        setResult({ status: "success", message: `Uploaded ${file.name}` });
        form.current?.reset();
        router.refresh();
        return;
      }
      let body: { error?: string; fieldErrors?: Record<string, string[]> } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      setResult({
        status: "error",
        message: body.error ?? "The upload failed. Please try again.",
        fields: body.fieldErrors,
      });
    };
    xhr.onerror = () => {
      setProgress(null);
      setResult({ status: "error", message: "The upload was interrupted. Please try again." });
    };
    setResult({ status: "idle" });
    setProgress(0);
    xhr.send(file);
  }

  const errors = (name: string) => result.fields?.[name];
  const busy = progress !== null;
  return (
    <form ref={form} onSubmit={submit} className="flex flex-col gap-3" noValidate>
      {result.status === "error" ? (
        <Alert tone="danger" title="The document wasn't uploaded">
          {result.message}
        </Alert>
      ) : result.status === "success" ? (
        <Alert tone="success" title={result.message ?? "Uploaded"} />
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {category ? null : (
          <Field label="Category" required errors={errors("category")}>
            {(p) => (
              <Select name="category" defaultValue="" {...p}>
                <option value="">Choose…</option>
                {Object.entries(categories).map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Title" description="Blank uses the file name" errors={errors("title")}>
          {(p) => <Input name="title" {...p} />}
        </Field>
      </div>
      <Field
        label="File"
        required
        description="Any size. Programs and scripts are refused."
        errors={errors("file")}
      >
        {(p) => <Input name="file" type="file" {...p} />}
      </Field>
      {restrictable ? (
        <label className="text-text flex items-center gap-2 text-sm">
          <input type="checkbox" name="restricted" />
          Restricted: only people with sensitive document access can see it
        </label>
      ) : null}
      {busy ? (
        <div className="flex items-center gap-2 text-sm">
          <progress
            id={progressId}
            max={100}
            value={progress}
            className="w-48"
            aria-label="Upload progress"
          />
          <span className="tabular text-secondary">{progress}%</span>
        </div>
      ) : null}
      <div>
        <Button type="submit" variant={previousVersionId ? "secondary" : "primary"} disabled={busy}>
          <Upload aria-hidden />
          {busy ? "Uploading…" : label}
        </Button>
      </div>
    </form>
  );
}
