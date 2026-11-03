import Link from "next/link";
import { cn } from "@/lib/cn";
import { HMBL_LOCKUP, HMBL_MARK } from "./logo-paths";

/** The HMBL mark. Sized by height; fills with the current text colour. */
export function HmblMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox={HMBL_MARK.viewBox}
      className={cn("h-4 w-auto fill-current", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path d={HMBL_MARK.d} />
    </svg>
  );
}

/** The full HMBL Entertainment lockup, for documents and signed-out pages. */
export function HmblLockup({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox={HMBL_LOCKUP.viewBox}
      className={cn("h-6 w-auto fill-current", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path d={HMBL_LOCKUP.d} />
    </svg>
  );
}

/** HMBL OS wordmark: the HMBL mark with "OS" set beside it. */
export function Brand({
  href = "/",
  size = "md",
}: {
  href?: string | null;
  /** lg for signed-out pages, where the brand stands alone above a card. */
  size?: "md" | "lg";
}) {
  const content = (
    <>
      <HmblMark className={size === "lg" ? "h-7" : "h-[1.0625rem]"} />
      <span
        aria-hidden
        className={cn(
          "text-secondary font-medium tracking-[0.18em]",
          size === "lg" ? "text-md" : "text-xs",
        )}
      >
        OS
      </span>
      <span className="sr-only">HMBL OS</span>
    </>
  );
  const className = cn(
    "text-text flex items-center rounded-md px-1",
    size === "lg" ? "gap-2.5" : "gap-1.5",
  );
  // Signed-out pages pass null: a link home would only bounce back to sign-in.
  return href === null ? (
    <span className={className}>{content}</span>
  ) : (
    <Link href={href} className={className} aria-label="HMBL OS home">
      {content}
    </Link>
  );
}
