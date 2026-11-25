import { callApi, type ApiClient } from "./api";
import { formatBrl } from "../lib/money";

/**
 * The counters of Início exactly as the site shows them, read from `GET /dashboard` (the server computes them within the actor's scope).
 * A value the server did not deliver is `null` ("—"), never zero. Online only; nothing here is cost or margin.
 */
export interface DashboardIndicators {
  readonly customers: string | null;
  readonly products: string | null;
  readonly sellable: string | null;
  readonly openOrders: string | null;
  readonly unsentAmount: string | null;
  /** The "Carteira de clientes" group as the site shows it above the customer list, in the server's own words. */
  readonly portfolio: readonly { readonly key: string; readonly label: string; readonly value: string | null }[];
}

export interface DashboardPort {
  load(): Promise<DashboardIndicators>;
}

interface MetricLike {
  readonly key: string;
  readonly value: { readonly kind: "count" | "money" | "percent"; readonly value: string | number } | null;
}
interface GroupLike {
  readonly key: string;
  readonly metrics: readonly (MetricLike & { readonly label?: string })[];
}

function formatValue(value: MetricLike["value"]): string | null {
  if (value === null || value === undefined) return null;
  if (value.kind === "count") return String(value.value).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (value.kind === "money") return formatBrl(String(value.value));
  return `${String(value.value).replace(".", ",")}%`;
}

function textOf(groups: readonly GroupLike[], group: string, key: string): string | null {
  return formatValue(groups.find((g) => g.key === group)?.metrics.find((m) => m.key === key)?.value ?? null);
}

/** Same five figures as the site's Início: Clientes, Produtos, Vendáveis, Pedidos em aberto, R$ não enviados. */
export function indicatorsOf(groups: readonly GroupLike[]): DashboardIndicators {
  return {
    customers: textOf(groups, "portfolio", "customers_total"),
    products: textOf(groups, "catalog", "products_visible"),
    sellable: textOf(groups, "catalog", "products_sellable"),
    openOrders: textOf(groups, "orders", "drafts"),
    unsentAmount: textOf(groups, "orders", "drafts_estimated_total"),
    portfolio: (groups.find((g) => g.key === "portfolio")?.metrics ?? []).map((m) => ({ key: m.key, label: m.label ?? m.key, value: formatValue(m.value) })),
  };
}

export function createDashboardPort(api: ApiClient): DashboardPort {
  return {
    async load() {
      const body = await callApi(() => api.GET("/dashboard"));
      return indicatorsOf(body.groups);
    },
  };
}
