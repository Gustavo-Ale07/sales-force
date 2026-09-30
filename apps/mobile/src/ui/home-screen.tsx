import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { DraftRecord, SyncStatus } from "@salesforce/mobile-db";
import type { Account } from "../auth/auth-port";
import type { ConnectivityState } from "../connectivity/connectivity";
import type { Repositories } from "../data/ports";
import { pickResumableDraft } from "../offline/home-summary";
import type { LocalOrdersPort } from "../offline/local-orders";
import { colors, spacing } from "../theme";
import { roleLabel } from "./account-labels";

export interface HomeScreenProps {
  readonly account: Account;
  /** True while the Home tab is the visible one: the numbers are re-read every time the seller comes back to it. */
  readonly active: boolean;
  readonly repositories: Pick<Repositories, "customers" | "products">;
  /** `null` when local drafts are not available (no offline services): the order shortcuts that need them are hidden. */
  readonly localOrders: LocalOrdersPort | null;
  readonly syncStatus: SyncStatus;
  readonly connectivity: ConnectivityState;
  readonly onNewOrder: () => void;
  readonly onResumeDraft: (localId: string) => void;
  /** Present only when a sync manager exists. */
  readonly onSyncNow?: () => void;
}

interface Summary {
  /** `null` = could not be read (shown as "—", never as zero). */
  readonly orders: number | null;
  readonly customers: number | null;
  readonly products: number | null;
  readonly resumable: DraftRecord | null;
}

const EMPTY_SUMMARY: Summary = { orders: null, customers: null, products: null, resumable: null };

function settled<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}

function StatTile({ label, value }: { label: string; value: number | null }) {
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${label}: ${value === null ? "indisponível" : value}`}>
      <Text style={styles.tileValue}>{value === null ? "—" : String(value)}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

function ActionRow({
  title,
  detail,
  onPress,
  disabled = false,
  primary = false,
}: {
  title: string;
  detail?: string;
  onPress: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <Pressable
      style={[styles.action, primary && styles.actionPrimary, disabled && styles.actionDisabled]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
    >
      <Text style={[styles.actionTitle, primary && styles.actionTitlePrimary]}>{title}</Text>
      {detail !== undefined && <Text style={[styles.actionDetail, primary && styles.actionDetailPrimary]}>{detail}</Text>}
    </Pressable>
  );
}

function EmptySection({ title, text }: { title: string; text: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>
        <Text style={styles.empty}>{text}</Text>
      </View>
    </View>
  );
}

/** Home: real shortcuts and counters from the data already on this device. No sales metrics until there is a source for them. */
export function HomeScreen({ account, active, repositories, localOrders, syncStatus, connectivity, onNewOrder, onResumeDraft, onSyncNow }: HomeScreenProps) {
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);

  useEffect(() => {
    if (!active) return;
    let current = true;
    const one = { search: "", page: 1, pageSize: 1 };
    Promise.allSettled([
      localOrders === null ? Promise.resolve<DraftRecord[]>([]) : localOrders.list(),
      repositories.customers.list(one),
      repositories.products.list(one),
    ]).then(([drafts, customers, products]) => {
      if (!current) return;
      const found = settled(drafts);
      setSummary({
        orders: localOrders === null ? null : found === null ? null : found.length,
        customers: settled(customers)?.total ?? null,
        products: settled(products)?.total ?? null,
        resumable: found === null ? null : pickResumableDraft(found),
      });
    });
    return () => {
      current = false;
    };
  }, [active, localOrders, repositories, syncStatus.phase, syncStatus.pending, syncStatus.needsAttention, syncStatus.lastSyncedAt]);

  const offline = connectivity === "offline";
  const syncing = syncStatus.phase === "syncing";
  const pendingTotal = syncStatus.pending + syncStatus.needsAttention;

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View>
        <Text style={styles.greeting} accessibilityRole="header">{`Olá, ${account.displayName}`}</Text>
        <Text style={styles.role}>{roleLabel(account)}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Ações rápidas</Text>
        <ActionRow primary title="Novo pedido" detail="Escolher cliente e produtos" onPress={onNewOrder} />
        {summary.resumable !== null && (
          <ActionRow
            title="Retomar pedido"
            detail={`${summary.resumable.customerName} · ${summary.resumable.itemCount} ${summary.resumable.itemCount === 1 ? "item" : "itens"}`}
            onPress={() => onResumeDraft(summary.resumable?.localId ?? "")}
          />
        )}
        {onSyncNow !== undefined && (
          <ActionRow
            title={syncing ? "Sincronizando..." : "Sincronizar agora"}
            detail={offline ? "Requer conexão com a internet" : undefined}
            onPress={onSyncNow}
            disabled={syncing || offline}
          />
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Neste aparelho</Text>
        <View style={styles.grid}>
          <StatTile label="Pedidos locais" value={summary.orders} />
          <StatTile label="Pendências de sincronização" value={localOrders === null ? null : pendingTotal} />
          <StatTile label="Clientes disponíveis" value={summary.customers} />
          <StatTile label="Produtos disponíveis" value={summary.products} />
        </View>
      </View>

      <EmptySection title="Performance" text="Indicadores comerciais ficarão disponíveis quando o histórico de vendas estiver sincronizado." />
      <EmptySection title="Engajamento da carteira" text="A análise da carteira ficará disponível quando o histórico de vendas estiver sincronizado." />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  greeting: { fontSize: 22, fontWeight: "800", color: colors.navy },
  role: { fontSize: 14, color: colors.textMuted, marginTop: spacing.xs },
  section: { gap: spacing.sm },
  sectionTitle: { fontSize: 13, fontWeight: "800", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  action: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: 52,
    justifyContent: "center",
  },
  actionPrimary: { backgroundColor: colors.navy, borderColor: colors.navy },
  actionDisabled: { opacity: 0.55 },
  actionTitle: { fontSize: 16, fontWeight: "700", color: colors.navy },
  actionTitlePrimary: { color: colors.onNavy },
  actionDetail: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  actionDetailPrimary: { color: "#d5dbf5" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  tile: {
    flexGrow: 1,
    flexBasis: "45%",
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: 2,
  },
  tileValue: { fontSize: 24, fontWeight: "800", color: colors.navy },
  tileLabel: { fontSize: 13, color: colors.textMuted },
  card: { backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  empty: { fontSize: 14, color: colors.textMuted },
});
