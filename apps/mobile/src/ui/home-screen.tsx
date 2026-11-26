import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { DraftRecord, SyncStatus } from "@salesforce/mobile-db";
import type { Account } from "../auth/auth-port";
import type { ConnectivityState } from "../connectivity/connectivity";
import type { DashboardIndicators, DashboardPort } from "../data/dashboard";
import type { Repositories } from "../data/ports";
import type { GoalsPort, GoalsSnapshot } from "../offline/goals-service";
import type { LocalOrdersPort } from "../offline/local-orders";
import type { TasksPort } from "../offline/tasks-service";
import { colors, fontSize, radius, spacing } from "../theme";
import { roleLabel } from "./account-labels";
import { moneyText, percentText, positivationText } from "./goals-screen";
import { formatTaskDateTime } from "./task-dates";

/** Pending (open) local tasks due on the device's current day, late ones included. */
export function tasksDueToday(items: readonly { status: string; dueAt: string }[], now: Date): number {
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  return items.filter((task) => task.status === "pending" && new Date(task.dueAt).getTime() < endOfDay).length;
}

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
  /** Present only when a sync manager exists. */
  readonly onSyncNow?: () => void;
  /** The site's Início counters (`GET /dashboard`), read online. Absent = the section is not shown. */
  readonly dashboard?: DashboardPort;
  /** DSH-5: goal x realized and positivation of the month, with the last value kept on the device. Absent = the panel is not shown. */
  readonly goals?: GoalsPort;
  /** Local tasks, for "tarefas do dia". Absent = that figure is not shown. */
  readonly tasks?: TasksPort;
  /** Opens M-24. */
  readonly onOpenGoals?: () => void;
}

interface Summary {
  /** `null` = could not be read (shown as "—", never as zero). */
  readonly orders: number | null;
  readonly customers: number | null;
  readonly products: number | null;
}

const EMPTY_SUMMARY: Summary = { orders: null, customers: null, products: null };

function settled<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}

function TextTile({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={styles.tile} accessible accessibilityLabel={`${label}: ${value === null ? "indisponível" : value}`}>
      <Text style={styles.tileValue}>{value === null ? "—" : value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
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


/** Home: real shortcuts and counters from the data already on this device. No sales metrics until there is a source for them. */
export function HomeScreen({ account, active, repositories, localOrders, syncStatus, connectivity, onNewOrder, onSyncNow, dashboard, goals, tasks, onOpenGoals }: HomeScreenProps) {
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [goalsSnapshot, setGoalsSnapshot] = useState<GoalsSnapshot | null>(null);
  const [tasksToday, setTasksToday] = useState<number | null>(null);
  const [indicators, setIndicators] = useState<DashboardIndicators | null>(null);
  const online = connectivity !== "offline";

  useEffect(() => {
    if (!active || !online || dashboard === undefined) return;
    let current = true;
    dashboard
      .load()
      .then((found) => {
        if (current) setIndicators(found);
      })
      .catch(() => undefined); // Informational: the tiles keep the last values read, or show "—".
    return () => {
      current = false;
    };
  }, [active, online, dashboard, syncStatus.lastSyncedAt]);

  // DSH-5: the stored value first (works offline), then the server's when there is a connection.
  useEffect(() => {
    if (!active || goals === undefined) return;
    let current = true;
    void goals
      .cached()
      .then((found) => {
        if (current && found !== null) setGoalsSnapshot(found);
      })
      .catch(() => undefined);
    if (online) {
      void goals
        .load()
        .then((found) => {
          if (current && found !== null) setGoalsSnapshot(found);
        })
        .catch(() => undefined);
    }
    return () => {
      current = false;
    };
  }, [active, online, goals, syncStatus.lastSyncedAt]);

  useEffect(() => {
    if (!active || tasks === undefined) return;
    let current = true;
    void tasks
      .list()
      .then((items) => {
        if (current) setTasksToday(tasksDueToday(items, new Date()));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [active, tasks, syncStatus.dataRevision, syncStatus.lastSyncedAt]);

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
      });
    });
    return () => {
      current = false;
    };
  }, [active, localOrders, repositories, syncStatus.phase, syncStatus.pending, syncStatus.needsAttention, syncStatus.lastSyncedAt, syncStatus.dataRevision]);

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
        {onSyncNow !== undefined && (
          <ActionRow
            title={syncing ? "Sincronizando…" : "Sincronizar agora"}
            detail={offline ? "Requer conexão com a internet" : undefined}
            onPress={onSyncNow}
            disabled={syncing || offline}
          />
        )}
      </View>

      {dashboard !== undefined && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Indicadores</Text>
          <View style={styles.grid}>
            <TextTile label="Clientes" value={indicators?.customers ?? null} />
            <TextTile label="Produtos" value={indicators?.products ?? null} />
            <TextTile label="Vendáveis" value={indicators?.sellable ?? null} />
            <TextTile label="Pedidos em aberto" value={indicators?.openOrders ?? null} />
            <TextTile label="R$ não enviados" value={indicators?.unsentAmount ?? null} />
          </View>
        </View>
      )}

      {goals !== undefined && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Resumo do mês</Text>
          <Pressable onPress={onOpenGoals} disabled={onOpenGoals === undefined} accessibilityRole="button" accessibilityLabel="Abrir metas">
            <View style={styles.grid}>
              <TextTile label="Meta do mês" value={goalsSnapshot === null ? null : moneyText(goalsSnapshot.data.total.revenue.target)} />
              <TextTile label="Realizado" value={goalsSnapshot === null ? null : moneyText(goalsSnapshot.data.total.revenue.realized)} />
              <TextTile label="Atingido" value={goalsSnapshot === null ? null : percentText(goalsSnapshot.data.total.revenue.percent)} />
              <TextTile label="Positivação" value={goalsSnapshot === null ? null : positivationText(goalsSnapshot.data.total.positivation)} />
              <TextTile label="Pedidos pendentes" value={String(syncStatus.pending)} />
              <TextTile label="Pedidos com erro" value={String(syncStatus.needsAttention)} />
              {tasks !== undefined && <TextTile label="Tarefas do dia" value={tasksToday === null ? null : String(tasksToday)} />}
            </View>
          </Pressable>
          {goalsSnapshot !== null && <Text style={styles.tileLabel}>{formatTaskDateTime(goalsSnapshot.fetchedAt)}</Text>}
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Neste aparelho</Text>
        <View style={styles.grid}>
          <StatTile label="Pedidos locais" value={summary.orders} />
          <StatTile label="Pendências de sincronização" value={localOrders === null ? null : pendingTotal} />
          <StatTile label="Clientes disponíveis" value={summary.customers} />
          <StatTile label="Produtos no aparelho" value={summary.products} />
        </View>
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  greeting: { fontSize: fontSize.title, fontWeight: "800", color: colors.navy },
  role: { fontSize: 14, color: colors.textMuted, marginTop: spacing.xs },
  section: { gap: spacing.sm },
  sectionTitle: { fontSize: 13, fontWeight: "800", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  action: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
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
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: 2,
  },
  tileValue: { fontSize: fontSize.headline, fontWeight: "800", color: colors.navy },
  tileLabel: { fontSize: 13, color: colors.textMuted },
});
