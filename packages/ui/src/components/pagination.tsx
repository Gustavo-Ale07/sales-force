import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../lib/cn";
import { Select } from "./select";

export interface PaginationProps {
  /** 1-based current page. */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  className?: string;
}

/** Returns page numbers with `null` gaps: 1 … 4 5 [6] 7 8 … 20. */
export function pageWindow(page: number, pageCount: number): (number | null)[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const pages = new Set<number>([1, pageCount, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((p) => pages.add(p));
  if (page >= pageCount - 2) [pageCount - 3, pageCount - 2, pageCount - 1].forEach((p) => pages.add(p));
  const sorted = [...pages].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  const result: (number | null)[] = [];
  sorted.forEach((p, i) => {
    const previous = sorted[i - 1];
    if (previous !== undefined && p - previous > 1) result.push(null);
    result.push(p);
  });
  return result;
}

const pageButton =
  "inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-line px-1.5 text-xs text-fg hover:bg-surface-2 disabled:pointer-events-none disabled:text-fg-faint";

/** Table footer: "Mostrando 1–25 de 38", page buttons and page-size selector. Counts are integers (not money). */
export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange, pageSizeOptions = [25, 50, 100], className }: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  const first = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const last = Math.min(total, current * pageSize);
  const fmt = new Intl.NumberFormat("pt-BR");

  return (
    <div className={cn("flex flex-wrap items-center gap-3 border-t border-line px-3 py-1.5 text-xs text-fg-muted", className)}>
      <span aria-live="polite">
        {total === 0 ? "Nenhum registro" : `Mostrando ${fmt.format(first)}–${fmt.format(last)} de ${fmt.format(total)}`}
      </span>
      <span className="flex-1" />
      <nav aria-label="Paginação" className="flex items-center gap-1">
        <button type="button" className={pageButton} disabled={current <= 1} onClick={() => onPageChange(current - 1)} aria-label="Página anterior">
          <ChevronLeft size={13} aria-hidden="true" />
        </button>
        {pageWindow(current, pageCount).map((p, i) =>
          p === null ? (
            <span key={`gap-${i}`} aria-hidden="true" className="px-1">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              aria-label={`Página ${p}`}
              aria-current={p === current ? "page" : undefined}
              className={cn(pageButton, p === current && "border-accent bg-accent text-on-accent hover:bg-accent")}
              onClick={() => onPageChange(p)}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          className={pageButton}
          disabled={current >= pageCount}
          onClick={() => onPageChange(current + 1)}
          aria-label="Próxima página"
        >
          <ChevronRight size={13} aria-hidden="true" />
        </button>
      </nav>
      {onPageSizeChange ? (
        <Select
          size="sm"
          aria-label="Itens por página"
          wrapperClassName="w-[110px]"
          value={pageSize}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
        >
          {pageSizeOptions.map((size) => (
            <option key={size} value={size}>
              {size} por página
            </option>
          ))}
        </Select>
      ) : null}
    </div>
  );
}
