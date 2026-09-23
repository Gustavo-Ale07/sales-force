import type { ApiSchema } from "@salesforce/contracts/client";
import { Money, formatPercent, type Tone } from "@salesforce/ui";
import { Ban, AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { formatCount } from "../lib/labels";

type Metric = ApiSchema<"Metric">;
type MetricGroup = ApiSchema<"MetricGroup">;

export const METRIC_UNAVAILABLE = "Não disponível";

/** Looks up one metric by group+key across the `/dashboard` response, for screens that pick a few figures out of the full groups (e.g. Início's KPI row). */
export function findMetric(groups: readonly MetricGroup[], groupKey: string, metricKey: string): Metric | undefined {
  return groups.find((group) => group.key === groupKey)?.metrics.find((metric) => metric.key === metricKey);
}

/** A metric's numeric value when it is a plain count, or `null` when absent/not a count (e.g. unavailable, money, percent). */
export function metricCount(metric: Metric | undefined): number | null {
  return metric?.value?.kind === "count" ? metric.value.value : null;
}

/**
 * Per-metric visual accent shared by every screen that renders a dashboard `Metric` (currently the
 * Início and Clientes pages, both reading the same `/dashboard` "Carteira de clientes" group): only
 * figures that genuinely ask for attention get a tone/icon. Keeping this in one place is what keeps
 * the two screens from drifting into different treatments of the same data.
 */
export const METRIC_VISUALS: Partial<Record<string, { tone: Tone; icon: ReactNode }>> = {
  customers_blocked: { tone: "danger", icon: <Ban size={13} aria-hidden="true" /> },
  products_sellable_without_price: { tone: "warning", icon: <AlertTriangle size={13} aria-hidden="true" /> },
};

/** Same rendering as `MetricValueText`, for call sites that may not have found the metric at all (not just a `null` value). */
export function MetricValueOrUnavailable({ metric }: { metric: Metric | undefined }) {
  if (metric === undefined) return <span className="text-fg-faint">{METRIC_UNAVAILABLE}</span>;
  return <MetricValueText metric={metric} />;
}

export function MetricValueText({ metric }: { metric: Metric }) {
  const value = metric.value;
  if (value === null) return <span className="text-fg-faint">{METRIC_UNAVAILABLE}</span>;
  switch (value.kind) {
    case "count":
      return <>{formatCount(value.value)}</>;
    case "money":
      return <Money value={value.value} />;
    case "percent":
      return <>{formatPercent(value.value)}</>;
  }
}
