"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import type { FormState } from "@/server/http/action-result";

/** Picks the vendor; the bill starts with their currency, terms and usual TDS. */
export function StartBillForm({
  action,
  vendors,
  defaults,
  cancelHref,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  vendors: { id: string; name: string; currency: string }[];
  defaults: Record<string, string>;
  cancelHref: string;
}) {
  const f = useForm(action, defaults);
  return (
    <form action={f.action} key={f.formKey} className="max-w-form flex flex-col gap-4" noValidate>
      <FormAlert {...f} title="The bill wasn't started" />
      <Field label="Vendor" required errors={f.errors("vendorId")}>
        {(p) => (
          <Select name="vendorId" defaultValue={f.value("vendorId")} {...p}>
            <option value="">Choose…</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} ({v.currency})
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={f.pending}>
          {f.pending ? "Starting…" : "Start bill"}
        </Button>
        <Button asChild variant="quiet">
          <Link href={cancelHref}>Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
