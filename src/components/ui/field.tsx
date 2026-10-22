import { useId } from "react";
import { cn } from "@/lib/cn";

const control =
  "h-control w-full rounded-md border border-border bg-surface px-2.5 text-base text-text shadow-sm " +
  "placeholder:text-muted transition-colors duration-(--duration-fast) " +
  "hover:border-border-strong focus-visible:border-focus focus-visible:outline-2 focus-visible:outline-offset-0 " +
  "disabled:cursor-not-allowed disabled:bg-sunken disabled:text-disabled " +
  "aria-invalid:border-danger";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, className)} {...props} />;
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(control, "pr-8", className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, "h-auto min-h-20 py-1.5", className)} {...props} />;
}

type FieldProps = {
  label: string;
  /** Shown under the label. */
  description?: string;
  /** Validation messages for this field. */
  errors?: string[];
  required?: boolean;
  className?: string;
  children: (props: {
    id: string;
    "aria-invalid"?: true;
    "aria-describedby"?: string;
    required?: boolean;
  }) => React.ReactNode;
};

/**
 * Label, control, description and error kept together, wired for screen
 * readers. Errors appear under the field they describe.
 */
export function Field({ label, description, errors, required, className, children }: FieldProps) {
  const id = useId();
  const descriptionId = description ? `${id}-description` : undefined;
  const errorId = errors?.length ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-text text-sm font-medium">
        {label}
        {required ? (
          <span className="text-muted" aria-hidden>
            {" "}
            *
          </span>
        ) : null}
      </label>
      {description ? (
        <p id={descriptionId} className="text-muted text-xs">
          {description}
        </p>
      ) : null}
      {children({
        id,
        "aria-invalid": errorId ? true : undefined,
        "aria-describedby": describedBy,
        required,
      })}
      {errorId ? (
        <p id={errorId} className="text-danger text-xs">
          {errors!.join(" ")}
        </p>
      ) : null}
    </div>
  );
}
