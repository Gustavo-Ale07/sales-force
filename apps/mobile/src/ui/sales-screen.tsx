import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { SalesGroup, SyncStatus } from "@salesforce/mobile-db";
import type { ConnectivityState } from "../connectivity/connectivity";
import type { CustomerRepository, PageRequest } from "../data/ports";
import { formatBrl } from "../lib/money";
import type { LocalOrdersPort } from "../offline/local-orders";
import { EMPTY_SALES_FILTERS, type SalesFilters, type SalesRow, type SalesSummary } from "../offline/sales";
import { saleBadge } from "../offline/sales-status";
import { colors, spacing } from "../theme";
import { PagedListView } from "./paged-list-view";
import { SaleBadgeView, describeSaleValue } from "./sale-parts";
import { SaleDetailScreen } from "./sale-detail-screen";
import { SalesFilterChips, SalesFiltersSheet, countActiveSalesFilters } from "./sales-filters";
import { formatDateTime } from "./sync-status";

/** One line under the customer: order number (or none yet), item count and the local creation date. */
export function describeSaleMeta(draft: SalesRow["draft"]): string {
  const number = draft.remoteDraftNumber !== null ? `Pedido nº ${draft.remoteDraftNumber}` : "Sem número ainda";
  return `${number} · ${draft.itemCount} ${draft.itemCount === 1 ? "item" : "itens"} · ${formatDateTime(draft.createdAt)}`;
}

function attentionText(draft: SalesRow["draft"]): string | null {
  if (draft.status === "sync_error") return "Não foi possível enviar. Toque para ver o que fazer.";
  if (draft.status === "conflict") return "Alterado em outro lugar. Toque para escolher a versão.";
  if (draft.status === "needs_review") return "Preços mudaram. Toque para revisar.";
  return null;
}

const SaleRowView = memo(function SaleRowView({ row, onOpen }: { row: SalesRow; onOpen: (localId: string) => void }) {
  const { draft, value } = row;
  const attention = attentionText(draft);
  return (
    <Pressable
      style={styles.row}
      onPress={() => onOpen(draft.localId)}
      accessibilityRole="button"
      accessibilityLabel={`Venda de ${draft.customerName}, ${saleBadge(draft).label}. Abrir detalhe`}
    >
      <View style={styles.rowTop}>
        <Text style={styles.customer} numberOfLines={1}>{draft.customerName}</Text>
        <Text style={styles.value}>{describeSaleValue(value)}</Text>
      </View>
      <Text style={styles.meta} numberOfLines={1}>{describeSaleMeta(draft)}</Text>
      <View style={styles.rowBottom}>
        <SaleBadgeView status={draft.status} remoteId={draft.remoteId} lastError={draft.lastError} />
        {value.partial && value.amount !== null && <Text style={styles.partial}>Valor parcial</Text>}
      </View>
      {attention !== null && <Text style={styles.attention}>{attention}</Text>}
    </Pressable>
  );
});

export interface SalesScreenProps {
  readonly localOrders: LocalOrdersPort;
  readonly customers: CustomerRepository;
  readonly syncStatus: SyncStatus;
  readonly connectivity: ConnectivityState;
  readonly onUnauthenticated: () => void;
  readonly onNewSale: () => void;
  readonly onContinue: (localId: string) => void;
  readonly onDuplicate: (localId: string) => void;
  readonly onSyncNow: () => void;
  /** Changes whenever the seller taps the "Minhas vendas" segment: an open detail closes and the list shows again. */
  readonly resetSignal?: number;
}

type SalesRequest = PageRequest & { readonly filters: SalesFilters; readonly tick: string };

const GROUPS: ReadonlyArray<{ key: SalesGroup; label: string }> = [
  { key: "unsent", label: "Não enviados" },
  { key: "sent", label: "Enviados" },
];

function describeSummary(summary: SalesSummary | null, group: SalesGroup): string {
  if (summary === null) return "";
  const count = group === "unsent" ? summary.counts.unsent : summary.counts.sent;
  const parts = [`${count} ${count === 1 ? "venda" : "vendas"}`];
  if (summary.amount !== null) {
    parts.push(`${group === "sent" ? "Total" : "Valor estimado"} ${formatBrl(summary.amount) ?? summary.amount}${summary.partial ? " (parcial)" : ""}`);
  }
  if (summary.lastUpdatedAt !== null) parts.push(`Atualizado ${formatDateTime(summary.lastUpdatedAt)}`);
  return parts.join(" · ");
}

/**
 * Central de Vendas: the seller's orders on this device, split into "Não enviados" (not yet accepted by the Force
 * backend) and "Enviados" (accepted by the Force backend — NOT the ERP). Everything is read from the local database,
 * so the whole screen works offline.
 */
export function SalesScreen({ localOrders, customers, syncStatus, connectivity, onUnauthenticated, onNewSale, onContinue, onDuplicate, onSyncNow, resetSignal = 0 }: SalesScreenProps) {
  const [filters, setFilters] = useState<SalesFilters>({ group: "unsent", ...EMPTY_SALES_FILTERS });
  const [search, setSearch] = useState("");
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [opened, setOpened] = useState<{ id: string; signal: number } | null>(null);
  const openId = opened !== null && opened.signal === resetSignal ? opened.id : null;
  const setOpenId = useCallback((id: string | null) => setOpened(id === null ? null : { id, signal: resetSignal }), [resetSignal]);
  const [changes, setChanges] = useState(0);
  const offlineSuffix = connectivity === "offline" ? " · dados salvos neste aparelho" : "";
  const filtersKey = JSON.stringify(filters);
  // Any sync movement or local action refreshes the list and the counters without polling.
  const tick = `${changes}:${syncStatus.phase}:${syncStatus.pending}:${syncStatus.needsAttention}:${syncStatus.lastSyncedAt ?? ""}`;
  const active = countActiveSalesFilters(filters);

  useEffect(() => {
    let current = true;
    localOrders
      .summarizeSales(filters, search)
      .then((found) => current && setSummary(found))
      .catch(() => current && setSummary(null));
    return () => {
      current = false;
    };
    // `filters` is tracked through its serialized key so an equal object does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localOrders, filtersKey, search, tick]);

  const load = useCallback((request: SalesRequest) => localOrders.listSales(request.filters, request), [localOrders]);
  const extra = useMemo(() => ({ filters, tick }), [filters, tick]);
  const changed = useCallback(() => setChanges((n) => n + 1), []);

  const selectGroup = (group: SalesGroup) => setFilters((current) => (current.group === group ? current : { ...current, group, statuses: [] }));

  const header = (
    <View style={styles.toolbar}>
      <View style={styles.tabs} accessibilityRole="tablist">
        {GROUPS.map(({ key, label }) => {
          const count = summary?.counts[key];
          const selected = filters.group === key;
          return (
            <Pressable
              key={key}
              style={[styles.tab, selected && styles.tabOn]}
              onPress={() => selectGroup(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={count === undefined ? label : `${label}, ${count}`}
            >
              <Text style={[styles.tabText, selected && styles.tabTextOn]}>{count === undefined ? label : `${label} (${count})`}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.toolbarRow}>
        <Pressable
          style={[styles.tool, active > 0 && styles.toolOn]}
          onPress={() => setFiltersOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={active > 0 ? `Filtros, ${active} ativo(s)` : "Filtros"}
        >
          <Text style={[styles.toolText, active > 0 && styles.toolTextOn]}>{active > 0 ? `Filtros (${active})` : "Filtros"}</Text>
        </Pressable>
        <Text style={styles.summary} numberOfLines={2}>{describeSummary(summary, filters.group)}</Text>
      </View>
      <SalesFilterChips filters={filters} onChange={setFilters} />
      <SalesFiltersSheet
        visible={filtersOpen}
        filters={filters}
        customers={customers}
        onUnauthenticated={onUnauthenticated}
        onApply={(next) => {
          setFilters(next);
          setFiltersOpen(false);
        }}
        onClose={() => setFiltersOpen(false)}
      />
    </View>
  );

  const unsent = filters.group === "unsent";
  return (
    <View style={styles.flex}>
      <View style={styles.cta}>
        <Pressable style={styles.ctaButton} onPress={onNewSale} accessibilityRole="button" accessibilityLabel="Nova venda">
          <Text style={styles.ctaText}>+ Nova venda</Text>
        </Pressable>
      </View>
      <View style={[styles.flex, openId !== null && styles.hidden]}>
        <PagedListView<SalesRow, SalesRequest>
          load={load}
          extra={extra}
          onSearchChange={setSearch}
          header={header}
          title={`Vendas${offlineSuffix}`}
          keyOf={(row) => row.draft.localId}
          renderItem={(row) => <SaleRowView row={row} onOpen={setOpenId} />}
          searchLabel="Buscar venda"
          searchPlaceholder="Buscar por cliente, código ou nº do pedido"
          emptyText={unsent ? "Nenhuma venda pendente." : "Nenhuma venda enviada ainda."}
          emptyHint={unsent ? "Toque em “+ Nova venda” para começar." : "As vendas aceitas pelo Force aparecem aqui."}
          {...(active > 0 ? { filteredEmptyText: "Nenhuma venda encontrada com esses filtros." } : {})}
          noResultText={(text) => `Nenhuma venda encontrada para “${text}”.`}
          noResultHint="Confira o nome do cliente, o código ou o número do pedido."
          onUnauthenticated={onUnauthenticated}
        />
      </View>
      {openId !== null && (
        <SaleDetailScreen
          localId={openId}
          localOrders={localOrders}
          connectivity={connectivity}
          onBack={() => setOpenId(null)}
          onChanged={changed}
          onContinue={onContinue}
          onDuplicate={onDuplicate}
          onSyncNow={onSyncNow}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hidden: { display: "none" },
  cta: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  ctaButton: { minHeight: 48, borderRadius: 8, backgroundColor: colors.red, alignItems: "center", justifyContent: "center" },
  ctaText: { color: colors.onNavy, fontSize: 16, fontWeight: "800" },
  toolbar: { gap: spacing.sm },
  tabs: { flexDirection: "row", borderRadius: 8, borderWidth: 1, borderColor: colors.navy, overflow: "hidden" },
  tab: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  tabOn: { backgroundColor: colors.navy },
  tabText: { color: colors.navy, fontWeight: "700", fontSize: 14 },
  tabTextOn: { color: colors.onNavy },
  toolbarRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  tool: { minHeight: 40, paddingHorizontal: spacing.md, borderRadius: 8, borderWidth: 1, borderColor: colors.navy, justifyContent: "center" },
  toolOn: { backgroundColor: colors.navy },
  toolText: { color: colors.navy, fontWeight: "700", fontSize: 14 },
  toolTextOn: { color: colors.onNavy },
  summary: { flex: 1, fontSize: 12, color: colors.textMuted },
  row: { backgroundColor: colors.surface, borderRadius: 8, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs, marginBottom: spacing.sm },
  rowTop: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  customer: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.text },
  value: { fontSize: 15, fontWeight: "700", color: colors.navy },
  meta: { fontSize: 13, color: colors.textMuted },
  rowBottom: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  partial: { fontSize: 12, color: colors.warning },
  attention: { fontSize: 13, color: colors.text },
});
