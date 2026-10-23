"use client";

import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { useForm } from "@/components/ui/use-form";
import { REVENUE_MODELS } from "@/server/projects/schemas";
import { LINE_CATEGORIES } from "@/server/commercial/schemas";
import { createCostCodeAction, createProjectTypeAction } from "./actions";

export function ProjectTypeForm() {
  const f = useForm(createProjectTypeAction, { defaultRevenueModel: "ITEMISED" });
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The project type wasn't added" success="Project type added" />
      <div className="grid gap-3 sm:grid-cols-[8rem_1fr_1fr]">
        <Field label="Code" required errors={f.errors("code")}>
          {(p) => <Input name="code" defaultValue={f.value("code")} {...p} />}
        </Field>
        <Field label="Name" required errors={f.errors("name")}>
          {(p) => <Input name="name" defaultValue={f.value("name")} {...p} />}
        </Field>
        <Field label="Usual revenue model" errors={f.errors("defaultRevenueModel")}>
          {(p) => (
            <Select name="defaultRevenueModel" defaultValue={f.value("defaultRevenueModel")} {...p}>
              {Object.entries(REVENUE_MODELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Description" errors={f.errors("description")}>
        {(p) => <Input name="description" defaultValue={f.value("description")} {...p} />}
      </Field>
      <div>
        <Button type="submit" disabled={f.pending}>
          <Plus aria-hidden />
          {f.pending ? "Adding…" : "Add project type"}
        </Button>
      </div>
    </form>
  );
}

export function CostCodeForm() {
  const f = useForm(createCostCodeAction, { category: "CREW" });
  return (
    <form action={f.action} key={f.formKey} className="flex flex-col gap-3" noValidate>
      <FormAlert {...f} title="The cost code wasn't added" success="Cost code added" />
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr_1fr]">
        <Field label="Code" required description="e.g. CR-RIGGERS" errors={f.errors("code")}>
          {(p) => <Input name="code" defaultValue={f.value("code")} {...p} />}
        </Field>
        <Field label="Name" required errors={f.errors("name")}>
          {(p) => <Input name="name" defaultValue={f.value("name")} {...p} />}
        </Field>
        <Field label="Budget category" errors={f.errors("category")}>
          {(p) => (
            <Select name="category" defaultValue={f.value("category")} {...p}>
              {Object.entries(LINE_CATEGORIES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div>
        <Button type="submit" disabled={f.pending}>
          <Plus aria-hidden />
          {f.pending ? "Adding…" : "Add cost code"}
        </Button>
      </div>
    </form>
  );
}
