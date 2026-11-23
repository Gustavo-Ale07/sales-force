import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { SalesGroup, SyncStatus } from "@salesforce/mobile-db";
import type { ConnectivityState } from "../connectivity/connectivity";
import type { CustomerRepository, OrderRepository, PageRequest } from "../data/ports";
import { formatBrl } from "../lib/money";
import type { LocalOrdersPort } from "../offline/local-orders";
import { EMPTY_SALES_FILTERS, type SalesFilters, type SalesRow, type SalesSummary } from "../offline/sales";
import { saleActions, saleBadge } from "../offline/sales-status";
import { colors, control, radius, spacing } from "../theme";
import { Icon } from "./icons";
import type { OrderPdfPort } from "../offline/order-pdf";
import { PagedListView } from "./paged-list-view";
import { SaleBadgeView, describeSaleValue } from "./sale-parts";
import { SaleDetailScreen } from "./sale-detail-screen";
import { SalesFilterChips, SalesFiltersSheet, countActiveSalesFilters } from "./sales-filters";
import { formatDateTime } from "./sync-status";

/** One line under the customer: order number (or none yet), item count and the local creation date. */
/**
 * A sale the seller edits straight from the list: "Salvo no aparelho" and "Precisa de correção" open the wizard at the Summary.
 * Every other state (waiting, sent, error, conflict, price review) opens its detail, which explains it and offers the way out.
 */
export function isEditableSale(draft: SalesRow["draft"]): boolean {
  const label = saleBadge(draft).label;
  return (label === "Salvo no aparelho" || label === "Precisa de correção") && saleActions(draft).continue;
}

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

const SaleRowView = memo(function SaleRowView({ row, onOpen }: { row: SalesRow; onOpen: (localId: string, editable: boolean) => void }) {
  const { draft, value } = row;
  const attention = attentionText(draft);
  const editable = isEditableSale(draft);
  const saved = saleBadge(draft).label === "Salvo no aparelho";
  return (
    <Pressable
      style={[styles.row, saved && styles.rowSaved]}
      onPress={() => onOpen(draft.localId, editable)}
      // Long press always opens the detail (delete, duplicate, PDF) of a sale that a tap sends straight to editing.
      onLongPress={() => onOpen(draft.localId, false)}
      accessibilityRole="button"
      accessibilityLabel={`Venda de ${draft.customerName}, ${saleBadge(draft).label}. ${editable ? "Editar" : "Abrir detalhe"}`}
    >
      <View style={styles.rowTop}>
        <Text style={styles.customer} numberOfLines={1}>{draft.customerName}</Text>
        <Text style={styles.value}>{describeSaleValue(value)}</Text>
      </View>
      <Text style={styles.meta} numberOfLines={1}>{describeSaleMeta(draft)}</Text>
      <View style={styles.rowBottom}>
        <SaleBadgeView status={draft.status} remoteId={draft.remoteId} lastError={draft.lastError} sendState={draft.sendState} sendCode={draft.sendCode} erpStage={draft.erpStage} />
        {value.partial && value.amount !== null && <Text style={styles.partial}>Valor parcial</Text>}
        {editable && <Text style={styles.edit}>Editar</Text>}
      </View>
      {attention !== null && <Text style={styles.attention}>{attention}</Text>}
    </Pressable>
  );
});

export interface SalesScreenProps {
  readonly localOrders: LocalOrdersPort;
  readonly customers: CustomerRepository;
  readonly syncStatus: SyncStatus;
  /** Online read of a sent order, for the read-only discount approval card (M-14). */
  readonly orders?: Pick<OrderRepository, "get">;
  /** Share-sheet PDF of an order; without it the action is hidden. */
  readonly orderPdf?: OrderPdfPort;
  readonly connectivity: ConnectivityState;
  readonly onUnauthenticated: () => void;
  readonly onNewSale: () => void;
  readonly onContinue: (localId: string) => void;
  readonly onDuplicate: (localId: string) => void;
  readonly onSyncNow: () => void;
  /** Changes whenever the seller taps the "Minhas vendas" segment: an open detail closes and the list shows again. */
  readonly resetSignal?: number;
  /** Tells the shell whether a sale's detail is open (Android Back closes it first). */
  readonly onDetailChange?: (open: boolean) => void;
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
    parts.push(`${formatBrl(summary.amount) ?? summary.amount}${summary.partial ? " (parcial)" : ""}`);
  }
  return parts.join(" · ");
}

/**
 * Central de Vendas: the seller's orders on this device, split into "Não enviados" (not yet accepted by the Force
 * backend) and "Enviados" (accepted by the Force backend — NOT the ERP). Everything is read from the local database,
 * so the whole screen works offline.
 */
export function SalesScreen({ localOrders, customers, orders, orderPdf, syncStatus, connectivity, onUnauthenticated, onNewSale, onContinue, onDuplicate, onSyncNow, resetSignal = 0, onDetailChange }: SalesScreenProps) {
  const [filters, setFilters] = useState<SalesFilters>({ group: "unsent", ...EMPTY_SALES_FILTERS });
  const [search, setSearch] = useState("");
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [opened, setOpened] = useState<{ id: string; signal: number } | null>(null);
  const openId = opened !== null && opened.signal === resetSignal ? opened.id : null;
  const setOpenId = useCallback((id: string | null) => setOpened(id === null ? null : { id, signal: resetSignal }), [resetSignal]);
  useEffect(() => {
    onDetailChange?.(openId !== null);
  }, [openId, onDetailChange]);
  const [changes, setChanges] = useState(0);
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
  const openSale = useCallback(
    (id: string, editable: boolean) => {
      if (editable) onContinue(id);
      else setOpenId(id);
    },
    [onContinue, setOpenId],
  );
  const changed = useCallback(() => setChanges((n) => n + 1), []);

  const selectGroup = (group: SalesGroup) => setFilters((current) => (current.group === group ? current : { ...current, group, statuses: [], stages: [] }));

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
          <Icon name="filter" color={active > 0 ? colors.onNavy : colors.navy} size={20} />
          <Text style={[styles.toolText, active > 0 && styles.toolTextOn]}>Filtros</Text>
          {active > 0 && (
            <View style={styles.toolBadge}>
              <Text style={styles.toolBadgeText}>{active}</Text>
            </View>
          )}
        </Pressable>
        <Text style={styles.summary} numberOfLines={1}>{describeSummary(summary, filters.group)}</Text>
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
          <Icon name="plus" color={colors.onNavy} size={20} />
          <Text style={styles.ctaText}>Nova venda</Text>
        </Pressable>
      </View>
      <View style={[styles.flex, openId !== null && styles.hidden]}>
        <PagedListView<SalesRow, SalesRequest>
          load={load}
          extra={extra}
          onSearchChange={setSearch}
          header={header}
          hideCount
          keyOf={(row) => row.draft.localId}
          renderItem={(row) => <SaleRowView row={row} onOpen={openSale} />}
          searchLabel="Buscar venda"
          searchPlaceholder="Buscar por cliente, código ou nº do pedido"
          emptyText={unsent ? "Nenhuma venda pendente." : "Nenhuma venda enviada ainda."}
          emptyHint={unsent ? "Toque em “Nova venda” para começar." : "As vendas aceitas pelo Force aparecem aqui."}
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
          {...(orders !== undefined ? { orders } : {})}
          {...(orderPdf !== undefined ? { orderPdf } : {})}
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
  ctaButton: { minHeight: control.heightLarge, borderRadius: radius.md, backgroundColor: colors.red, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: spacing.sm },
  ctaText: { color: colors.onNavy, fontSize: 16, fontWeight: "800" },
  toolbar: { gap: spacing.sm },
  tabs: { flexDirection: "row", borderRadius: radius.md, borderWidth: 1, borderColor: colors.navy, overflow: "hidden" },
  tab: { flex: 1, minHeight: control.height, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  tabOn: { backgroundColor: colors.navy },
  tabText: { color: colors.navy, fontWeight: "700", fontSize: 14 },
  tabTextOn: { color: colors.onNavy },
  toolbarRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  tool: { minHeight: control.height, paddingHorizontal: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.navy, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  toolBadge: { minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.red, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  toolBadgeText: { color: colors.onNavy, fontSize: 11, fontWeight: "800" },
  toolOn: { backgroundColor: colors.navy },
  toolText: { color: colors.navy, fontWeight: "700", fontSize: 14 },
  toolTextOn: { color: colors.onNavy },
  summary: { flex: 1, fontSize: 13, color: colors.textMuted },
  row: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.xs, marginBottom: spacing.sm },
  rowSaved: { borderColor: colors.navy, borderWidth: 2 },
  edit: { marginLeft: "auto", color: colors.red, fontSize: 14, fontWeight: "800" },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: spacing.sm },
  customer: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.text },
  value: { fontSize: 15, fontWeight: "700", color: colors.navy },
  meta: { fontSize: 13, color: colors.textMuted },
  rowBottom: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  partial: { fontSize: 12, color: colors.warning },
  attention: { fontSize: 13, color: colors.text },
});
