import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { useRef, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Skeleton } from "./skeleton";

export interface TableProps extends ComponentProps<"table"> {
  /** Accessible name of the scrollable region (required: describes the data set). */
  label: string;
  /** Tailwind max-height class enabling the sticky header, e.g. "max-h-[60vh]". */
  maxHeightClassName?: string;
  containerClassName?: string;
}

/**
 * Dense data table. The container is a focusable, labelled scroll region (keyboard scrolling) and
 * ArrowUp/ArrowDown/Home/End move focus between interactive rows (`<TableRow interactive>`).
 */
export function Table({ label, maxHeightClassName, containerClassName, className, children, ...props }: TableProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const active = document.activeElement as HTMLElement | null;
    const row = active?.closest<HTMLElement>("tr[data-interactive]");
    if (!row || !containerRef.current) return;
    const rows = Array.from(containerRef.current.querySelectorAll<HTMLElement>("tbody tr[data-interactive]"));
    const index = rows.indexOf(row);
    if (index < 0) return;
    let target: HTMLElement | undefined;
    if (event.key === "ArrowDown") target = rows[index + 1];
    else if (event.key === "ArrowUp") target = rows[index - 1];
    else if (event.key === "Home") target = rows[0];
    else target = rows[rows.length - 1];
    if (target) {
      event.preventDefault();
      target.focus();
    }
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- arrow-key navigation between interactive rows
    <div
      ref={containerRef}
      role="region"
      aria-label={label}
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- focusable scroll region (WCAG 2.1.1)
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn("overflow-auto", maxHeightClassName, containerClassName)}
    >
      <table className={cn("w-full border-collapse text-xs", className)} {...props}>
        {children}
      </table>
    </div>
  );
}

export function TableHeader({ className, ...props }: ComponentProps<"thead">) {
  return <thead className={cn("sticky top-0 z-10 bg-surface-2", className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentProps<"tbody">) {
  return <tbody className={cn("[&>tr:last-child>td]:border-b-0", className)} {...props} />;
}

export interface TableRowProps extends ComponentProps<"tr"> {
  selected?: boolean;
  /** Focusable row (tabIndex 0, arrow-key navigation); Enter/Space call onActivate. */
  interactive?: boolean;
  onActivate?: () => void;
}

export function TableRow({ className, selected, interactive, onActivate, onKeyDown, onClick, ...props }: TableRowProps) {
  return (
    <tr
      data-interactive={interactive || undefined}
      tabIndex={interactive ? 0 : undefined}
      data-selected={selected || undefined}
      className={cn(
        "group hover:bg-surface-2 focus-visible:outline-offset-[-2px]",
        selected && "bg-accent-weak hover:bg-accent-weak",
        interactive && onActivate && "cursor-pointer",
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented && onActivate) onActivate();
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || event.target !== event.currentTarget) return;
        if (onActivate && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onActivate();
        }
      }}
      {...props}
    />
  );
}

export type SortDirection = "asc" | "desc";

export interface TableHeadProps extends ComponentProps<"th"> {
  numeric?: boolean;
}

export function TableHead({ className, numeric, scope = "col", ...props }: TableHeadProps) {
  return (
    <th
      scope={scope}
      className={cn(
        "whitespace-nowrap border-b border-line px-2.5 py-1.5 text-left text-2xs font-semibold uppercase tracking-wider text-fg-muted",
        numeric && "text-right",
        className,
      )}
      {...props}
    />
  );
}

export interface SortableHeadProps extends Omit<TableHeadProps, "onClick"> {
  /** Current direction of THIS column, or null/undefined when not sorted by it. */
  direction?: SortDirection | null;
  onSort: () => void;
}

export function SortableHead({ direction, onSort, numeric, children, className, ...props }: SortableHeadProps) {
  const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ChevronsUpDown;
  return (
    <TableHead
      numeric={numeric}
      aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}
      className={className}
      {...props}
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          "-mx-1 inline-flex items-center gap-1 rounded-sm px-1 uppercase tracking-wider hover:text-fg",
          direction && "text-fg",
        )}
      >
        {children}
        <Icon size={11} aria-hidden="true" className={direction ? "" : "opacity-50"} />
      </button>
    </TableHead>
  );
}

export interface TableCellProps extends ComponentProps<"td"> {
  numeric?: boolean;
  /** Allow long text to wrap instead of forcing one line. */
  wrap?: boolean;
}

export function TableCell({ className, numeric, wrap, ...props }: TableCellProps) {
  return (
    <td
      className={cn(
        "border-b border-line px-2.5 py-1.5 align-middle",
        wrap ? "" : "whitespace-nowrap",
        numeric && "text-right tabular-nums",
        className,
      )}
      {...props}
    />
  );
}

export function TableCaption({ className, ...props }: ComponentProps<"caption">) {
  return <caption className={cn("sr-only", className)} {...props} />;
}

export interface TableMessageRowProps {
  colSpan: number;
  children: ReactNode;
}

/** Full-width row for empty / error content inside the table body. */
export function TableMessageRow({ colSpan, children }: TableMessageRowProps) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        {children}
      </td>
    </tr>
  );
}

export interface TableLoadingRowsProps {
  columns: number;
  rows?: number;
}

/** Skeleton rows keep the table layout stable while loading. */
export function TableLoadingRows({ columns, rows = 6 }: TableLoadingRowsProps) {
  return (
    <>
      <tr>
        <td colSpan={columns} className="sr-only">
          <span role="status">Carregando…</span>
        </td>
      </tr>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} aria-hidden="true">
          {Array.from({ length: columns }, (_, c) => (
            <td key={c} className="border-b border-line px-2.5 py-2.5">
              <Skeleton className={c === 0 ? "w-[70%]" : "w-[50%]"} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
