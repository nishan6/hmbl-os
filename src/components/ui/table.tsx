import { cn } from "@/lib/cn";

/*
 * Dense data tables. Numbers and money right-aligned with tabular figures;
 * header sticks while the body scrolls; rows highlight on hover only.
 * On narrow screens the table scrolls horizontally inside its container
 * rather than squeezing columns.
 */

export function Table({
  className,
  dense,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement> & { dense?: boolean }) {
  return (
    // Focusable so keyboard users can scroll a table wider than the screen.
    <div
      tabIndex={0}
      className="border-separator bg-surface overflow-x-auto rounded-lg border shadow-sm"
    >
      <table
        data-dense={dense ? "" : undefined}
        className={cn("group/table w-full border-collapse text-sm", className)}
        {...props}
      />
    </div>
  );
}

export function THead(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className="bg-surface-2 sticky top-0 z-10" {...props} />;
}

export function TBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className="divide-separator divide-y" {...props} />;
}

export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("hover:bg-hover transition-colors", className)} {...props} />;
}

type Align = "left" | "right" | "center";
const align = (a: Align = "left") =>
  a === "right" ? "text-right tabular" : a === "center" ? "text-center" : "text-left";

export function TH({
  className,
  align: a,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { align?: Align }) {
  return (
    <th
      scope="col"
      className={cn(
        "h-row-dense border-separator text-secondary border-b px-3 text-xs font-medium whitespace-nowrap",
        align(a),
        className,
      )}
      {...props}
    />
  );
}

export function TD({
  className,
  align: a,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: Align }) {
  return (
    <td
      className={cn(
        "h-row text-text group-data-dense/table:h-row-dense px-3 align-middle",
        align(a),
        className,
      )}
      {...props}
    />
  );
}
