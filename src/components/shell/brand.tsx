import Link from "next/link";

/** HMBL OS wordmark. Original mark: a stacked bar glyph, not a borrowed logo. */
export function Brand({ href = "/" }: { href?: string | null }) {
  const content = (
    <>
      <svg viewBox="0 0 20 20" className="size-5" aria-hidden>
        <rect x="2" y="3" width="16" height="3.5" rx="1.2" className="fill-accent" />
        <rect x="2" y="8.25" width="11" height="3.5" rx="1.2" className="fill-text opacity-80" />
        <rect x="2" y="13.5" width="6" height="3.5" rx="1.2" className="fill-text opacity-45" />
      </svg>
      <span className="text-base font-semibold tracking-tight">
        HMBL <span className="text-secondary font-normal">OS</span>
      </span>
    </>
  );
  const className = "text-text flex items-center gap-2 rounded-md px-1";
  // Signed-out pages pass null: a link home would only bounce back to sign-in.
  return href === null ? (
    <span className={className}>{content}</span>
  ) : (
    <Link href={href} className={className}>
      {content}
    </Link>
  );
}
