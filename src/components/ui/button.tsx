import { Slot } from "radix-ui";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "quiet" | "destructive";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover shadow-sm",
  secondary: "bg-surface text-text border border-border hover:bg-hover shadow-sm",
  quiet: "text-text hover:bg-hover",
  destructive: "bg-danger text-white hover:opacity-90 shadow-sm dark:text-bg",
};

const sizes: Record<Size, string> = {
  sm: "h-control-sm px-2.5 text-sm gap-1.5",
  md: "h-control px-3 text-base gap-2",
  lg: "h-control-lg px-4 text-base gap-2",
};

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  /** Render the child element (e.g. a Link) with button styles. */
  asChild?: boolean;
};

export function buttonClasses(
  variant: Variant = "secondary",
  size: Size = "md",
  className?: string,
) {
  return cn(
    "inline-flex shrink-0 select-none items-center justify-center rounded-md font-medium whitespace-nowrap",
    "transition-colors duration-(--duration-fast) ease-(--ease-standard)",
    "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
    variants[variant],
    sizes[size],
    className,
  );
}

/**
 * One primary action per view. Secondary for the rest, quiet for low-emphasis
 * actions in toolbars and tables, destructive only behind a confirmation.
 */
export function Button({ variant, size, asChild, className, type, ...props }: ButtonProps) {
  const Component = asChild ? Slot.Root : "button";
  return (
    <Component
      type={asChild ? undefined : (type ?? "button")}
      className={buttonClasses(variant, size, className)}
      {...props}
    />
  );
}

/** Icon-only button. `label` is required and becomes the accessible name. */
export function IconButton({
  label,
  className,
  size = "md",
  variant = "quiet",
  ...props
}: Omit<ButtonProps, "children" | "aria-label"> & { label: string; children: React.ReactNode }) {
  return (
    <Button
      aria-label={label}
      title={label}
      variant={variant}
      size={size}
      className={cn("aspect-square px-0", className)}
      {...props}
    />
  );
}
