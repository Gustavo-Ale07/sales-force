import { Group } from "@visx/group";
import { scaleLinear } from "@visx/scale";
import { Bar } from "@visx/shape";
import { cn } from "../lib/cn";
import type { Tone } from "./badge";

export interface BarChartDatum {
  key: string;
  label: string;
  value: number;
  /** Colours the filled bar; default is a neutral grey (use a semantic tone only when the figure needs attention). */
  tone?: Tone;
}

export interface SimpleBarChartProps {
  data: BarChartDatum[];
  /** Value formatter for the trailing number (default: pt-BR integer count, e.g. "1.234"). */
  formatValue?: (value: number) => string;
  className?: string;
}

const toneFillClass: Record<Tone, string> = {
  neutral: "fill-fg-faint",
  accent: "fill-accent",
  success: "fill-ok",
  warning: "fill-warn",
  danger: "fill-danger",
  info: "fill-info",
};

const BAR_W = 240;
const BAR_H = 10;

const defaultFormatValue = (value: number) => new Intl.NumberFormat("pt-BR").format(value);

/**
 * Read-only horizontal bar list for small counts already present in the caller's data — this component
 * never fetches or aggregates anything itself. Every label and value is plain DOM text (accessible by
 * default, works with page zoom/find-in-page); the SVG bar underneath is decorative (`aria-hidden`), so
 * assistive tech gets exactly the same label/value pairs a sighted user reads, without a hidden companion
 * table. `data` should already be non-empty; render an `EmptyState` upstream when there is nothing to show.
 */
export function SimpleBarChart({ data, formatValue = defaultFormatValue, className }: SimpleBarChartProps) {
  const max = Math.max(1, ...data.map((datum) => datum.value));
  const scale = scaleLinear<number>({ domain: [0, max], range: [0, BAR_W] });

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {data.map((datum) => (
        <div key={datum.key} className="grid grid-cols-[8rem_1fr_auto] items-center gap-2.5 text-xs">
          <span className="truncate text-fg-muted" title={datum.label}>
            {datum.label}
          </span>
          <svg aria-hidden="true" viewBox={`0 0 ${BAR_W} ${BAR_H}`} width="100%" height={BAR_H} preserveAspectRatio="none">
            <Group>
              <Bar x={0} y={0} width={BAR_W} height={BAR_H} rx={2} className="fill-surface-3" />
              <Bar
                x={0}
                y={0}
                width={datum.value > 0 ? Math.max(3, scale(datum.value)) : 0}
                height={BAR_H}
                rx={2}
                className={toneFillClass[datum.tone ?? "neutral"]}
              />
            </Group>
          </svg>
          <span className="tabular-nums font-semibold text-fg">{formatValue(datum.value)}</span>
        </div>
      ))}
    </div>
  );
}
